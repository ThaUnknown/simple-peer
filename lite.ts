/*! simple-peer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
import debug from 'debug'
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCDataChannel, RTCDataChannelEvent, RTCPeerConnectionIceEvent, MediaStream, MediaStreamTrack } from 'webrtc-polyfill'
import { Duplex, DuplexEvents, Callback } from 'streamx'
import errCode from 'err-code'
import { randomBytes, arr2hex, text2arr } from 'uint8-util'

const Debug = debug('simple-peer')

const MAX_BUFFERED_AMOUNT = 64 * 1024
const ICECOMPLETE_TIMEOUT = 5 * 1000
const CHANNEL_CLOSING_TIMEOUT = 5 * 1000

// HACK: Filter trickle lines when trickle is disabled #354
function filterTrickle (sdp: string): string {
  return sdp.replace(/a=ice-options:trickle\s\n/g, '')
}

function warn (message: string): void {
  console.warn(message)
}

interface SignalData {
  type?: string
  sdp?: string
  candidate?: RTCIceCandidateInit
  renegotiate?: boolean
  transceiverRequest?: {
    kind: string
    init?: Record<string, unknown>
  }
}

interface PeerOptions {
  initiator?: boolean
  channelConfig?: RTCDataChannelInit
  channelName?: string
  config?: RTCConfiguration
  offerOptions?: RTCOfferOptions
  answerOptions?: RTCAnswerOptions
  sdpTransform?: (sdp: string) => string
  streams?: MediaStream[]
  stream?: MediaStream
  trickle?: boolean
  allowHalfTrickle?: boolean
  iceCompleteTimeout?: number
  objectMode?: boolean
  allowHalfOpen?: boolean
}

interface AddressInfo {
  port: number | undefined
  family: string | undefined
  address: string | undefined
}

interface StatsReport {
  id: string
  type: string
  timestamp: number
  values?: Record<string, unknown>[]
  localCandidateId?: string
  remoteCandidateId?: string
  selectedCandidatePairId?: string
  googLocalAddress?: string
  googRemoteAddress?: string
  googActiveConnection?: string
  selected?: boolean
  ip?: string
  address?: string
  port?: number
  ipAddress?: string
  portNumber?: number
  [key: string]: unknown
}

interface LegacyStatsReport {
  result: () => LegacyStatsResult[]
}

interface LegacyStatsResult {
  id: string
  type: string
  timestamp: number
  names: () => string[]
  stat: (name: string) => unknown
}

interface PeerEvents extends DuplexEvents<Uint8Array, Uint8Array> {
  signal: (data: SignalData) => void
  connect: () => void
  disconnect: () => void
  iceStateChange: (iceConnectionState: RTCIceConnectionState, iceGatheringState: RTCIceGatheringState) => void
  signalingStateChange: (signalingState: RTCSignalingState) => void
  negotiated: () => void
  iceTimeout: () => void
  _iceComplete: () => void
  track?: (track: MediaStreamTrack, stream: MediaStream) => void
  stream?: (stream: MediaStream) => void
}

/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few extra methods.
 * Duplex stream.
 */
class Peer extends Duplex<Uint8Array, Uint8Array, Uint8Array, Uint8Array, true, true, PeerEvents> {
  _pc: RTCPeerConnection | null
  _id: string
  channelName: string | null
  initiator: boolean
  channelConfig: RTCDataChannelInit
  channelNegotiated: boolean
  config: RTCConfiguration
  offerOptions: RTCOfferOptions
  answerOptions: RTCAnswerOptions
  sdpTransform: (sdp: string) => string
  trickle: boolean
  allowHalfTrickle: boolean
  iceCompleteTimeout: number
  _destroying: boolean
  _connected: boolean
  remoteAddress: string | undefined
  remoteFamily: string | undefined
  remotePort: number | undefined
  localAddress: string | undefined
  localFamily: string | undefined
  localPort: number | undefined
  _pcReady: boolean
  _channelReady: boolean
  _iceComplete: boolean
  _iceCompleteTimer: ReturnType<typeof setTimeout> | null
  _channel: RTCDataChannel | null
  _pendingCandidates: RTCIceCandidateInit[]
  _isNegotiating: boolean
  _firstNegotiation: boolean
  _batchedNegotiation: boolean
  _queuedNegotiation: boolean
  _sendersAwaitingStable: RTCRtpSender[]
  _closingInterval: ReturnType<typeof setInterval> | null
  _remoteTracks: Array<{ track: MediaStreamTrack; stream: MediaStream }> | null
  _remoteStreams: MediaStream[] | null
  _chunk: Uint8Array | null
  _cb: Callback | null
  _interval: ReturnType<typeof setInterval> | null
  _isReactNativeWebrtc: boolean
  _connecting: boolean
  _onFinishBound: (() => void) | null
  __objectMode: boolean

  static WEBRTC_SUPPORT: boolean
  static config: RTCConfiguration
  static channelConfig: RTCDataChannelInit

  constructor (opts: PeerOptions = {}) {
    const mergedOpts = Object.assign({
      allowHalfOpen: false
    }, opts)

    super(mergedOpts as unknown as ConstructorParameters<typeof Duplex<Uint8Array, Uint8Array, Uint8Array, Uint8Array, true, true, PeerEvents>>[0])

    this.__objectMode = !!opts.objectMode // streamx is objectMode by default, so implement readable's functionality

    this._id = arr2hex(randomBytes(4)).slice(0, 7)
    this._debug('new peer %o', opts)

    this.channelName = opts.initiator
      ? opts.channelName || arr2hex(randomBytes(20))
      : null

    this.initiator = opts.initiator || false
    this.channelConfig = opts.channelConfig || Peer.channelConfig
    this.channelNegotiated = this.channelConfig.negotiated || false
    this.config = Object.assign({}, Peer.config, opts.config)
    this.offerOptions = opts.offerOptions || {}
    this.answerOptions = opts.answerOptions || {}
    this.sdpTransform = opts.sdpTransform || ((sdp: string) => sdp)
    this.trickle = opts.trickle !== undefined ? opts.trickle : true
    this.allowHalfTrickle = opts.allowHalfTrickle !== undefined ? opts.allowHalfTrickle : false
    this.iceCompleteTimeout = opts.iceCompleteTimeout || ICECOMPLETE_TIMEOUT

    this._destroying = false
    this._connected = false

    this.remoteAddress = undefined
    this.remoteFamily = undefined
    this.remotePort = undefined
    this.localAddress = undefined
    this.localFamily = undefined
    this.localPort = undefined

    if (!RTCPeerConnection) {
      if (typeof window === 'undefined') {
        throw errCode(new Error('No WebRTC support: Specify `opts.wrtc` option in this environment'), 'ERR_WEBRTC_SUPPORT')
      } else {
        throw errCode(new Error('No WebRTC support: Not a supported browser'), 'ERR_WEBRTC_SUPPORT')
      }
    }

    this._pcReady = false
    this._channelReady = false
    this._iceComplete = false // ice candidate trickle done (got null candidate)
    this._iceCompleteTimer = null // send an offer/answer anyway after some timeout
    this._channel = null
    this._pendingCandidates = []

    this._isNegotiating = false // is this peer waiting for negotiation to complete?
    this._firstNegotiation = true
    this._batchedNegotiation = false // batch synchronous negotiations
    this._queuedNegotiation = false // is there a queued negotiation request?
    this._sendersAwaitingStable = []
    this._closingInterval = null

    this._remoteTracks = []
    this._remoteStreams = []

    this._chunk = null
    this._cb = null
    this._interval = null
    this._connecting = false

    try {
      this._pc = new RTCPeerConnection(this.config)
    } catch (err) {
      this.__destroy(errCode(err as Error, 'ERR_PC_CONSTRUCTOR'))
      return
    }

    // We prefer feature detection whenever possible, but sometimes that's not
    // possible for certain implementations.
    this._isReactNativeWebrtc = typeof (this._pc as unknown as Record<string, unknown>)._peerConnectionId === 'number'

    this._pc.oniceconnectionstatechange = () => {
      this._onIceStateChange()
    }
    this._pc.onicegatheringstatechange = () => {
      this._onIceStateChange()
    }
    this._pc.onconnectionstatechange = () => {
      this._onConnectionStateChange()
    }
    this._pc.onsignalingstatechange = () => {
      this._onSignalingStateChange()
    }
    this._pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      this._onIceCandidate(event)
    }

    // HACK: Fix for odd Firefox behavior, see: https://github.com/feross/simple-peer/pull/783
    if (typeof (this._pc as unknown as Record<string, unknown>).peerIdentity === 'object') {
      ((this._pc as unknown as Record<string, unknown>).peerIdentity as Promise<unknown>).catch((err: Error) => {
        this.__destroy(errCode(err, 'ERR_PC_PEER_IDENTITY'))
      })
    }

    // Other spec events, unused by this implementation:
    // - onconnectionstatechange
    // - onicecandidateerror
    // - onfingerprintfailure
    // - onnegotiationneeded

    if (this.initiator || this.channelNegotiated) {
      this._setupData({
        channel: this._pc.createDataChannel(this.channelName!, this.channelConfig)
      } as RTCDataChannelEvent)
    } else {
      this._pc.ondatachannel = (event: RTCDataChannelEvent) => {
        this._setupData(event)
      }
    }

    this._debug('initial negotiation')
    this._needsNegotiation()

    this._onFinishBound = () => {
      this._onFinish()
    }
    this.once('finish', this._onFinishBound)
  }

  get bufferSize (): number {
    return (this._channel && this._channel.bufferedAmount) || 0
  }

  // HACK: it's possible channel.readyState is "closing" before peer.destroy() fires
  // https://bugs.chromium.org/p/chromium/issues/detail?id=882743
  get connected (): boolean {
    return (this._connected && this._channel !== null && this._channel.readyState === 'open')
  }

  address (): AddressInfo {
    return { port: this.localPort, family: this.localFamily, address: this.localAddress }
  }

  signal (data: SignalData | string): void {
    if (this._destroying) return
    if (this.destroyed) throw errCode(new Error('cannot signal after peer is destroyed'), 'ERR_DESTROYED')
    let parsedData: SignalData
    if (typeof data === 'string') {
      try {
        parsedData = JSON.parse(data)
      } catch (err) {
        parsedData = {}
      }
    } else {
      parsedData = data
    }
    this._debug('signal()')

    if (parsedData.renegotiate && this.initiator) {
      this._debug('got request to renegotiate')
      this._needsNegotiation()
    }
    if (parsedData.transceiverRequest && this.initiator) {
      this._debug('got request for transceiver')
      this.addTransceiver?.(parsedData.transceiverRequest.kind, parsedData.transceiverRequest.init)
    }
    if (parsedData.candidate) {
      if (this._pc!.remoteDescription && this._pc!.remoteDescription.type) {
        this._addIceCandidate(parsedData.candidate)
      } else {
        this._pendingCandidates.push(parsedData.candidate)
      }
    }
    if (parsedData.sdp) {
      this._pc!.setRemoteDescription(new RTCSessionDescription(parsedData as RTCSessionDescriptionInit))
        .then(() => {
          if (this.destroyed) return

          this._pendingCandidates.forEach(candidate => {
            this._addIceCandidate(candidate)
          })
          this._pendingCandidates = []

          if (this._pc!.remoteDescription!.type === 'offer') this._createAnswer()
        })
        .catch((err: Error) => {
          this.__destroy(errCode(err, 'ERR_SET_REMOTE_DESCRIPTION'))
        })
    }
    if (!parsedData.sdp && !parsedData.candidate && !parsedData.renegotiate && !parsedData.transceiverRequest) {
      this.__destroy(errCode(new Error('signal() called with invalid signal data'), 'ERR_SIGNALING'))
    }
  }

  _addIceCandidate (candidate: RTCIceCandidateInit): void {
    const iceCandidateObj = new RTCIceCandidate(candidate)
    this._pc!.addIceCandidate(iceCandidateObj)
      .catch((err: Error) => {
        if (!iceCandidateObj.address || iceCandidateObj.address.endsWith('.local')) {
          warn('Ignoring unsupported ICE candidate.')
        } else {
          this.__destroy(errCode(err, 'ERR_ADD_ICE_CANDIDATE'))
        }
      })
  }

  /**
   * Send text/binary data to the remote peer.
   */
  send (chunk: ArrayBufferView | ArrayBuffer | Uint8Array | string | Blob): void {
    if (this._destroying) return
    if (this.destroyed) throw errCode(new Error('cannot send after peer is destroyed'), 'ERR_DESTROYED')
    this._channel!.send(chunk as string | Blob | ArrayBuffer | ArrayBufferView)
  }

  _needsNegotiation (): void {
    this._debug('_needsNegotiation')
    if (this._batchedNegotiation) return // batch synchronous renegotiations
    this._batchedNegotiation = true
    queueMicrotask(() => {
      this._batchedNegotiation = false
      if (this.initiator || !this._firstNegotiation) {
        this._debug('starting batched negotiation')
        this.negotiate()
      } else {
        this._debug('non-initiator initial negotiation request discarded')
      }
      this._firstNegotiation = false
    })
  }

  negotiate (): void {
    if (this._destroying) return
    if (this.destroyed) throw errCode(new Error('cannot negotiate after peer is destroyed'), 'ERR_DESTROYED')

    if (this.initiator) {
      if (this._isNegotiating) {
        this._queuedNegotiation = true
        this._debug('already negotiating, queueing')
      } else {
        this._debug('start negotiation')
        setTimeout(() => { // HACK: Chrome crashes if we immediately call createOffer
          this._createOffer()
        }, 0)
      }
    } else {
      if (this._isNegotiating) {
        this._queuedNegotiation = true
        this._debug('already negotiating, queueing')
      } else {
        this._debug('requesting negotiation from initiator')
        this.emit('signal', { // request initiator to renegotiate
          type: 'renegotiate',
          renegotiate: true
        })
      }
    }
    this._isNegotiating = true
  }

  _final (cb: Callback): void {
    if (!(this as unknown as { _readableState: { ended: boolean } })._readableState.ended) this.push(null)
    cb(null)
  }

  __destroy (err?: Error | null): void {
    this.end()
    this._destroy(() => {}, err || null)
  }

  _destroy (cb: Callback, err?: Error | null): void {
    if (this.destroyed || this._destroying) return
    this._destroying = true

    this._debug('destroying (error: %s)', err && (err.message || err))

    setTimeout(() => { // allow events concurrent with the call to _destroy() to fire (see #692)
      if (this._connected) this.emit('disconnect')
      this._connected = false
      this._pcReady = false
      this._channelReady = false
      this._remoteTracks = null
      this._remoteStreams = null

      clearInterval(this._closingInterval!)
      this._closingInterval = null

      clearInterval(this._interval!)
      this._interval = null
      this._chunk = null
      this._cb = null

      if (this._onFinishBound) this.removeListener('finish', this._onFinishBound)
      this._onFinishBound = null

      if (this._channel) {
        try {
          this._channel.close()
        } catch (err) {}

        // allow events concurrent with destruction to be handled
        this._channel.onmessage = null
        this._channel.onopen = null
        this._channel.onclose = null
        this._channel.onerror = null
      }
      if (this._pc) {
        try {
          this._pc.close()
        } catch (err) {}

        // allow events concurrent with destruction to be handled
        this._pc.oniceconnectionstatechange = null
        this._pc.onicegatheringstatechange = null
        this._pc.onsignalingstatechange = null
        this._pc.onicecandidate = null
        this._pc.ontrack = null
        this._pc.ondatachannel = null
      }
      this._pc = null
      this._channel = null
      if (err) this.emit('error', err)
      cb()
    }, 0)
  }

  _setupData (event: RTCDataChannelEvent): void {
    if (!event.channel) {
      // In some situations `pc.createDataChannel()` returns `undefined` (in wrtc),
      // which is invalid behavior. Handle it gracefully.
      // See: https://github.com/feross/simple-peer/issues/163
      return this.__destroy(errCode(new Error('Data channel event is missing `channel` property'), 'ERR_DATA_CHANNEL'))
    }

    this._channel = event.channel
    this._channel.binaryType = 'arraybuffer'

    if (typeof this._channel.bufferedAmountLowThreshold === 'number') {
      this._channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT
    }

    this.channelName = this._channel.label

    this._channel.onmessage = (event: MessageEvent) => {
      this._onChannelMessage(event)
    }
    this._channel.onbufferedamountlow = () => {
      this._onChannelBufferedAmountLow()
    }
    this._channel.onopen = () => {
      this._onChannelOpen()
    }
    this._channel.onclose = () => {
      this._onChannelClose()
    }
    this._channel.onerror = (event: Event) => {
      const rtcErrorEvent = event as RTCErrorEvent
      const err = rtcErrorEvent.error instanceof Error
        ? rtcErrorEvent.error
        : new Error(`Datachannel error: ${(event as unknown as Record<string, unknown>).message} ${(event as unknown as Record<string, unknown>).filename}:${(event as unknown as Record<string, unknown>).lineno}:${(event as unknown as Record<string, unknown>).colno}`)
      this.__destroy(errCode(err, 'ERR_DATA_CHANNEL'))
    }

    // HACK: Chrome will sometimes get stuck in readyState "closing", let's check for this condition
    // https://bugs.chromium.org/p/chromium/issues/detail?id=882743
    let isClosing = false
    this._closingInterval = setInterval(() => { // No "onclosing" event
      if (this._channel && this._channel.readyState === 'closing') {
        if (isClosing) this._onChannelClose() // closing timed out: equivalent to onclose firing
        isClosing = true
      } else {
        isClosing = false
      }
    }, CHANNEL_CLOSING_TIMEOUT)
  }

  _write (chunk: Uint8Array, cb: Callback): void {
    if (this.destroyed) return cb(errCode(new Error('cannot write after peer is destroyed'), 'ERR_DATA_CHANNEL'))

    if (this._connected) {
      try {
        this.send(chunk)
      } catch (err) {
        return this.__destroy(errCode(err as Error, 'ERR_DATA_CHANNEL'))
      }
      if (this._channel!.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        this._debug('start backpressure: bufferedAmount %d', this._channel!.bufferedAmount)
        this._cb = cb
      } else {
        cb(null)
      }
    } else {
      this._debug('write before connect')
      this._chunk = chunk
      this._cb = cb
    }
  }

  // When stream finishes writing, close socket. Half open connections are not
  // supported.
  _onFinish (): void {
    if (this.destroyed) return

    // Wait a bit before destroying so the socket flushes.
    // TODO: is there a more reliable way to accomplish this?
    const destroySoon = (): void => {
      setTimeout(() => this.__destroy(), 1000)
    }

    if (this._connected) {
      destroySoon()
    } else {
      this.once('connect', destroySoon)
    }
  }

  _startIceCompleteTimeout (): void {
    if (this.destroyed) return
    if (this._iceCompleteTimer) return
    this._debug('started iceComplete timeout')
    this._iceCompleteTimer = setTimeout(() => {
      if (!this._iceComplete) {
        this._iceComplete = true
        this._debug('iceComplete timeout completed')
        this.emit('iceTimeout')
        this.emit('_iceComplete')
      }
    }, this.iceCompleteTimeout)
  }

  _createOffer (): void {
    if (this.destroyed) return

    this._pc!.createOffer(this.offerOptions)
      .then((offer: RTCSessionDescriptionInit) => {
        if (this.destroyed) return
        if (!this.trickle && !this.allowHalfTrickle) offer.sdp = filterTrickle(offer.sdp!)
        offer.sdp = this.sdpTransform(offer.sdp!)

        const sendOffer = (): void => {
          if (this.destroyed) return
          const signal = this._pc!.localDescription || offer
          this._debug('signal')
          this.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          })
        }

        const onSuccess = (): void => {
          this._debug('createOffer success')
          if (this.destroyed) return
          if (this.trickle || this._iceComplete) sendOffer()
          else this.once('_iceComplete', sendOffer) // wait for candidates
        }

        const onError = (err: Error): void => {
          this.__destroy(errCode(err, 'ERR_SET_LOCAL_DESCRIPTION'))
        }

        this._pc!.setLocalDescription(offer)
          .then(onSuccess)
          .catch(onError)
      })
      .catch((err: Error) => {
        this.__destroy(errCode(err, 'ERR_CREATE_OFFER'))
      })
  }

  _createAnswer (): void {
    if (this.destroyed) return

    this._pc!.createAnswer(this.answerOptions)
      .then((answer: RTCSessionDescriptionInit) => {
        if (this.destroyed) return
        if (!this.trickle && !this.allowHalfTrickle) answer.sdp = filterTrickle(answer.sdp!)
        answer.sdp = this.sdpTransform(answer.sdp!)

        const sendAnswer = (): void => {
          if (this.destroyed) return
          const signal = this._pc!.localDescription || answer
          this._debug('signal')
          this.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          })
          if (!this.initiator) this._requestMissingTransceivers?.()
        }

        const onSuccess = (): void => {
          if (this.destroyed) return
          if (this.trickle || this._iceComplete) sendAnswer()
          else this.once('_iceComplete', sendAnswer)
        }

        const onError = (err: Error): void => {
          this.__destroy(errCode(err, 'ERR_SET_LOCAL_DESCRIPTION'))
        }

        this._pc!.setLocalDescription(answer)
          .then(onSuccess)
          .catch(onError)
      })
      .catch((err: Error) => {
        this.__destroy(errCode(err, 'ERR_CREATE_ANSWER'))
      })
  }

  _onConnectionStateChange (): void {
    if (this.destroyed || this._destroying) return
    if (this._pc!.connectionState === 'failed') {
      this.__destroy(errCode(new Error('Connection failed.'), 'ERR_CONNECTION_FAILURE'))
    }
  }

  _onIceStateChange (): void {
    if (this.destroyed) return
    const iceConnectionState = this._pc!.iceConnectionState
    const iceGatheringState = this._pc!.iceGatheringState

    this._debug(
      'iceStateChange (connection: %s) (gathering: %s)',
      iceConnectionState,
      iceGatheringState
    )
    this.emit('iceStateChange', iceConnectionState, iceGatheringState)

    if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
      this._pcReady = true
      this._maybeReady()
    }
    if (iceConnectionState === 'failed') {
      this.__destroy(errCode(new Error('Ice connection failed.'), 'ERR_ICE_CONNECTION_FAILURE'))
    }
    if (iceConnectionState === 'closed') {
      this.__destroy(errCode(new Error('Ice connection closed.'), 'ERR_ICE_CONNECTION_CLOSED'))
    }
  }

  getStats (cb: (err: Error | null, reports?: StatsReport[]) => void): void {
    // statreports can come with a value array instead of properties
    const flattenValues = (report: StatsReport): StatsReport => {
      if (Object.prototype.toString.call(report.values) === '[object Array]') {
        report.values!.forEach(value => {
          Object.assign(report, value)
        })
      }
      return report
    }

    // Promise-based getStats() (standard)
    if (this._pc!.getStats.length === 0 || this._isReactNativeWebrtc) {
      this._pc!.getStats()
        .then((res: RTCStatsReport) => {
          const reports: StatsReport[] = []
          res.forEach((report: RTCStats) => {
            reports.push(flattenValues(report as unknown as StatsReport))
          })
          cb(null, reports)
        }, (err: Error) => cb(err))

    // Single-parameter callback-based getStats() (non-standard)
    } else if (this._pc!.getStats.length > 0) {
      (this._pc!.getStats as unknown as (callback: (res: LegacyStatsReport) => void, errorCallback: (err: Error) => void) => void)((res: LegacyStatsReport) => {
        // If we destroy connection in `connect` callback this code might happen to run when actual connection is already closed
        if (this.destroyed) return

        const reports: StatsReport[] = []
        res.result().forEach((result: LegacyStatsResult) => {
          const report: StatsReport = {
            id: '',
            type: '',
            timestamp: 0
          }
          result.names().forEach((name: string) => {
            (report as Record<string, unknown>)[name] = result.stat(name)
          })
          report.id = result.id
          report.type = result.type
          report.timestamp = result.timestamp
          reports.push(flattenValues(report))
        })
        cb(null, reports)
      }, (err: Error) => cb(err))

    // Unknown browser, skip getStats() since it's anyone's guess which style of
    // getStats() they implement.
    } else {
      cb(null, [])
    }
  }

  _maybeReady (): void {
    this._debug('maybeReady pc %s channel %s', this._pcReady, this._channelReady)
    if (this._connected || this._connecting || !this._pcReady || !this._channelReady) return

    this._connecting = true

    // HACK: We can't rely on order here, for details see https://github.com/js-platform/node-webrtc/issues/339
    const findCandidatePair = (): void => {
      if (this.destroyed || this._destroying) return

      this.getStats((err, items) => {
        if (this.destroyed || this._destroying) return

        // Treat getStats error as non-fatal. It's not essential.
        if (err) items = []

        const remoteCandidates: Record<string, StatsReport> = {}
        const localCandidates: Record<string, StatsReport> = {}
        const candidatePairs: Record<string, StatsReport> = {}
        let foundSelectedCandidatePair = false

        items!.forEach((item: StatsReport) => {
          // TODO: Once all browsers support the hyphenated stats report types, remove
          // the non-hypenated ones
          if (item.type === 'remotecandidate' || item.type === 'remote-candidate') {
            remoteCandidates[item.id] = item
          }
          if (item.type === 'localcandidate' || item.type === 'local-candidate') {
            localCandidates[item.id] = item
          }
          if (item.type === 'candidatepair' || item.type === 'candidate-pair') {
            candidatePairs[item.id] = item
          }
        })

        const setSelectedCandidatePair = (selectedCandidatePair: StatsReport): void => {
          foundSelectedCandidatePair = true

          let local = localCandidates[selectedCandidatePair.localCandidateId as string]

          if (local && ((local.ip as string) || (local.address as string))) {
            // Spec
            this.localAddress = (local.ip as string) || (local.address as string)
            this.localPort = Number(local.port)
          } else if (local && (local.ipAddress as string)) {
            // Firefox
            this.localAddress = local.ipAddress as string
            this.localPort = Number(local.portNumber)
          } else if (typeof selectedCandidatePair.googLocalAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            const localParts = selectedCandidatePair.googLocalAddress.split(':')
            this.localAddress = localParts[0]
            this.localPort = Number(localParts[1])
          }
          if (this.localAddress) {
            this.localFamily = this.localAddress.includes(':') ? 'IPv6' : 'IPv4'
          }

          let remote = remoteCandidates[selectedCandidatePair.remoteCandidateId as string]

          if (remote && ((remote.ip as string) || (remote.address as string))) {
            // Spec
            this.remoteAddress = (remote.ip as string) || (remote.address as string)
            this.remotePort = Number(remote.port)
          } else if (remote && (remote.ipAddress as string)) {
            // Firefox
            this.remoteAddress = remote.ipAddress as string
            this.remotePort = Number(remote.portNumber)
          } else if (typeof selectedCandidatePair.googRemoteAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            const remoteParts = selectedCandidatePair.googRemoteAddress.split(':')
            this.remoteAddress = remoteParts[0]
            this.remotePort = Number(remoteParts[1])
          }
          if (this.remoteAddress) {
            this.remoteFamily = this.remoteAddress.includes(':') ? 'IPv6' : 'IPv4'
          }

          this._debug(
            'connect local: %s:%s remote: %s:%s',
            this.localAddress,
            this.localPort,
            this.remoteAddress,
            this.remotePort
          )
        }

        items!.forEach((item: StatsReport) => {
          // Spec-compliant
          if (item.type === 'transport' && item.selectedCandidatePairId) {
            setSelectedCandidatePair(candidatePairs[item.selectedCandidatePairId as string])
          }

          // Old implementations
          if (
            (item.type === 'googCandidatePair' && item.googActiveConnection === 'true') ||
            ((item.type === 'candidatepair' || item.type === 'candidate-pair') && item.selected)
          ) {
            setSelectedCandidatePair(item)
          }
        })

        // Ignore candidate pair selection in browsers like Safari 11 that do not have any local or remote candidates
        // But wait until at least 1 candidate pair is available
        if (!foundSelectedCandidatePair && (!Object.keys(candidatePairs).length || Object.keys(localCandidates).length)) {
          setTimeout(findCandidatePair, 100)
          return
        } else {
          this._connecting = false
          this._connected = true
          this.emit('connect')
        }

        if (this._chunk) {
          try {
            this.send(this._chunk)
          } catch (err) {
            return this.__destroy(errCode(err as Error, 'ERR_DATA_CHANNEL'))
          }
          this._chunk = null
          this._debug('sent chunk from "write before connect"')

          const cb = this._cb
          this._cb = null
          cb!(null)
        }

        // If `bufferedAmountLowThreshold` and 'onbufferedamountlow' are unsupported,
        // fallback to using setInterval to implement backpressure.
        if (typeof this._channel!.bufferedAmountLowThreshold !== 'number') {
          this._interval = setInterval(() => this._onInterval(), 150)
          if ((this._interval as NodeJS.Timeout).unref) (this._interval as NodeJS.Timeout).unref()
        }

        this._debug('connect')
        this.emit('connect')
      })
    }
    findCandidatePair()
  }

  _onInterval (): void {
    if (!this._cb || !this._channel || this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      return
    }
    this._onChannelBufferedAmountLow()
  }

  _onSignalingStateChange (): void {
    if (this.destroyed) return

    if (this._pc!.signalingState === 'stable') {
      this._isNegotiating = false

      // HACK: Firefox doesn't yet support removing tracks when signalingState !== 'stable'
      this._debug('flushing sender queue', this._sendersAwaitingStable)
      this._sendersAwaitingStable.forEach((sender: RTCRtpSender) => {
        this._pc!.removeTrack(sender)
        this._queuedNegotiation = true
      })
      this._sendersAwaitingStable = []

      if (this._queuedNegotiation) {
        this._debug('flushing negotiation queue')
        this._queuedNegotiation = false
        this._needsNegotiation() // negotiate again
      } else {
        this._debug('negotiated')
        this.emit('negotiated')
      }
    }

    this._debug('signalingStateChange %s', this._pc!.signalingState)
    this.emit('signalingStateChange', this._pc!.signalingState)
  }

  _onIceCandidate (event: RTCPeerConnectionIceEvent): void {
    if (this.destroyed) return
    if (event.candidate && this.trickle) {
      this.emit('signal', {
        type: 'candidate',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid
        }
      })
    } else if (!event.candidate && !this._iceComplete) {
      this._iceComplete = true
      this.emit('_iceComplete')
    }
    // as soon as we've received one valid candidate start timeout
    if (event.candidate) {
      this._startIceCompleteTimeout()
    }
  }

  _onChannelMessage (event: MessageEvent): void {
    if (this.destroyed) return
    let data: Uint8Array | string = event.data
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data)
    } else if (this.__objectMode === false) {
      data = text2arr(data as string)
    }
    this.push(data as Uint8Array)
  }

  _onChannelBufferedAmountLow (): void {
    if (this.destroyed || !this._cb) return
    this._debug('ending backpressure: bufferedAmount %d', this._channel!.bufferedAmount)
    const cb = this._cb
    this._cb = null
    cb(null)
  }

  _onChannelOpen (): void {
    if (this._connected || this.destroyed) return
    this._debug('on channel open')
    this._channelReady = true
    this._maybeReady()
  }

  _onChannelClose (): void {
    if (this.destroyed) return
    this._debug('on channel close')
    this.__destroy()
  }

  _debug (...args: unknown[]): void {
    const allArgs = [].slice.call(args) as string[]
    allArgs[0] = '[' + this._id + '] ' + allArgs[0]
    Debug.apply(null, allArgs as [string, ...unknown[]])
  }

  // Optional method to be overridden in subclasses
  addTransceiver? (kind: string, init?: Record<string, unknown>): void
  _requestMissingTransceivers? (): void
}

Peer.WEBRTC_SUPPORT = !!RTCPeerConnection

/**
 * Expose peer and data channel config for overriding all Peer
 * instances. Otherwise, just set opts.config or opts.channelConfig
 * when constructing a Peer.
 */
Peer.config = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:global.stun.twilio.com:3478'
      ]
    }
  ]
} as RTCConfiguration

Peer.channelConfig = {}

export default Peer
export { Peer, PeerOptions, SignalData, AddressInfo, StatsReport }
