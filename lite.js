/*! simple-peer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
import debug from 'debug'
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'webrtc-polyfill'
import { Duplex } from 'streamx'
import errCode from 'err-code'
import { randomBytes, arr2hex, text2arr } from 'uint8-util'

/** Type Definitions
 * Simple Peer Lite Options:
 * @typedef {{
 *   initiator: boolean;
 *   channelName?: string;
 *   channelConfig?: RTCDataChannelInit;
 *   config?: RTCConfiguration;
 *   offerOptions?: RTCOfferOptions;
 *   answerOptions?: RTCAnswerOptions;
 *   sdpTransform?: (string) => string;
 *   wrtc?: { RTCPeerConnection: function, RTCSessionDescription: function, RTCIceCandidate: function };
 *   trickle?: boolean;
 *   allowHalfTrickle?: boolean;
 *   objectMode?: boolean;
 *   iceRestartEnabled?: false | "onFailure" | "onDisconnect";
 *   iceFailureRecoveryTimeout?: number; //miliseconds to wait for ice restart to complete after the ice state reaches "failed".
 * }} SimplePeerLiteOptions
 */

const Debug = debug('simple-peer')

const MAX_BUFFERED_AMOUNT = 64 * 1024
const ICECOMPLETE_TIMEOUT = 5 * 1000
const CHANNEL_CLOSING_TIMEOUT = 5 * 1000
const ICEFAILURE_RECOVERY_TIMEOUT = 5 * 1000

// HACK: Filter trickle lines when trickle is disabled #354
function filterTrickle (sdp) {
  return sdp.replace(/a=ice-options:trickle\s\n/g, '')
}

function warn (message) {
  console.warn(message)
}

/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few extra methods.
 * Duplex stream.
 * @param {SimplePeerOptions} opts
 */
class Peer extends Duplex {

  /** @type {RTCPeerConnection} */
  _pc

  /** Create a new Simple Peer instance.
   * @param {SimplePeerOptions} opts
   */
  constructor (opts) {
    opts = Object.assign({
      allowHalfOpen: false
    }, opts)

    super(opts)

    this.__objectMode = !!opts.objectMode // streamx is objectMode by default, so implement readable's fuctionality

    this._id = arr2hex(randomBytes(4)).slice(0, 7)
    this._debug('new peer %o', opts)

    this.channelName = opts.initiator
      ? opts.channelName || arr2hex(randomBytes(20))
      : null

    this.initiator = opts.initiator || false
    this.channelConfig = opts.channelConfig || Peer.channelConfig
    this.channelNegotiated = this.channelConfig.negotiated
    this.config = Object.assign({}, Peer.config, opts.config)
    this.offerOptions = opts.offerOptions || {}
    this.answerOptions = opts.answerOptions || {}
    this.sdpTransform = opts.sdpTransform || (sdp => sdp)
    this.trickle = opts.trickle !== undefined ? opts.trickle : true
    this.allowHalfTrickle = opts.allowHalfTrickle !== undefined ? opts.allowHalfTrickle : false
    this.iceCompleteTimeout = opts.iceCompleteTimeout || ICECOMPLETE_TIMEOUT

    // Ice restart often only makes sense if trickle is enabled, and isn't currently supported in wrtc node polyfill https://github.com/feross/simple-peer/issues/579
    this.iceRestartEnabled = opts.iceRestartEnabled ?? ((this.trickle === true && !opts.wrtc) ? "onFailure" : false)
    if (this.iceRestartEnabled === true) this.iceRestartEnabled = "onFailure" // default to "onFailure" if user mistakenly passes true instead of a string
    this.iceFailureRecoveryTimeout = opts.iceFailureRecoveryTimeout ?? ICEFAILURE_RECOVERY_TIMEOUT // how long to wait for recovery from failed state
    this._iceFailureRecoveryTimer = null

    this._destroying = false
    this._connected = false
    this._connecting = false
    this._connectedOnce = false

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
    this._iceGatheringComplete = false // ice candidate trickle done (got null candidate)
    this._iceGatheringCompleteTimer = null // send an offer/answer anyway after some timeout
    this._channel = null
    this._pendingCandidates = []

    this._isNegotiating = false // is this peer waiting for negotiation to complete?
    this._isRestartingIce = false // is true while restarting ice and false once connected (only on initiator side)
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

    try {
      this._pc = new RTCPeerConnection(this.config)
    } catch (err) {
      this.__destroy(errCode(err, 'ERR_PC_CONSTRUCTOR'))
      return
    }

    // We prefer feature detection whenever possible, but sometimes that's not
    // possible for certain implementations.
    this._isReactNativeWebrtc = typeof this._pc._peerConnectionId === 'number'

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
    this._pc.onicecandidate = event => {
      this._onIceCandidate(event)
    }

    // HACK: Fix for odd Firefox behavior, see: https://github.com/feross/simple-peer/pull/783
    if (typeof this._pc.peerIdentity === 'object') {
      this._pc.peerIdentity.catch(err => {
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
        channel: this._pc.createDataChannel(this.channelName, this.channelConfig)
      })
    } else {
      this._pc.ondatachannel = event => {
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

  get bufferSize () {
    return (this._channel && this._channel.bufferedAmount) || 0
  }

  // HACK: it's possible channel.readyState is "closing" before peer.destroy() fires
  // https://bugs.chromium.org/p/chromium/issues/detail?id=882743
  get connected () {
    return (this._connected && this._channel.readyState === 'open')
  }

  address () {
    return { port: this.localPort, family: this.localFamily, address: this.localAddress }
  }

  signal (data) {
    if (this._destroying) return
    if (this.destroyed) throw errCode(new Error('cannot signal after peer is destroyed'), 'ERR_DESTROYED')
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (err) {
        data = {}
      }
    }
    this._debug('signal()')

    if (data.renegotiate && this.initiator) {
      this._debug('got request to renegotiate')
      this._needsNegotiation()
    }
    if (data.transceiverRequest && this.initiator) {
      this._debug('got request for transceiver')
      this.addTransceiver(data.transceiverRequest.kind, data.transceiverRequest.init)
    }
    if (data.candidate) {
      if (this._pc.remoteDescription && this._pc.remoteDescription.type) {
        this._addIceCandidate(data.candidate)
      } else {
        this._pendingCandidates.push(data.candidate)
      }
    }
    if (data.sdp) {
      this._pc.setRemoteDescription(new RTCSessionDescription(data))
        .then(() => {
          if (this.destroyed) return

          this._pendingCandidates.forEach(candidate => {
            this._addIceCandidate(candidate)
          })
          this._pendingCandidates = []

          if (this._pc.remoteDescription.type === 'offer') this._createAnswer()
        })
        .catch(err => {
          this.__destroy(errCode(err, 'ERR_SET_REMOTE_DESCRIPTION'))
        })
    }
    if (!data.sdp && !data.candidate && !data.renegotiate && !data.transceiverRequest) {
      this.__destroy(errCode(new Error('signal() called with invalid signal data'), 'ERR_SIGNALING'))
    }
  }

  _addIceCandidate (candidate) {
    const iceCandidateObj = new RTCIceCandidate(candidate)
    this._pc.addIceCandidate(iceCandidateObj)
      .catch(err => {
        if (!iceCandidateObj.address || iceCandidateObj.address.endsWith('.local')) {
          warn('Ignoring unsupported ICE candidate.')
        } else {
          this.__destroy(errCode(err, 'ERR_ADD_ICE_CANDIDATE'))
        }
      })
  }

  /**
   * Send text/binary data to the remote peer.
   * @param {ArrayBufferView|ArrayBuffer|Uint8Array|string|Blob} chunk
   */
  send (chunk) {
    if (this._destroying) return
    if (this.destroyed) throw errCode(new Error('cannot send after peer is destroyed'), 'ERR_DESTROYED')
    this._channel.send(chunk)
  }

  _needsNegotiation () {
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

  negotiate () {
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

  /**
   * Trigger an ICE Restart on the WebRTC connection.
   * This will re-gather network candidates and find the best network route between peers.
   * Useful for re-establishing connection or improving latency between peers when networks change.
   * ICE Restarts should not cause media or data pauses, unless the connection cannot be re-established.
   * @warn Ice restarts are only allowed on the initiator peer!
   * @returns {boolean} - Returns true if ice restart was initiated successfully; false if conditions aren't met for ice restart (not the initiator, already restarting ice, destroyed(ing) peer).
   */
  restartIce () {
    if (this.destroyed || this._destroying) return false;
    if (!this.initiator) {
      this._debug('restartIce() only works for the initiator')
      return false;
    } if (this._isRestartingIce) {
      this._debug('Already restarting ice, ignoring restartIce()')
      return false;
    } else {
      this._debug('Restarting ICE')
      if (this._iceFailureRecoveryTimer != null) {
        // Restart the recovery timer when restartIce() is manually called,
        // Note: this._iceFailureRecoveryTimer being non-null indicates that ice has previously entered the failed state and has not recovered by now.
        clearTimeout(this._iceFailureRecoveryTimer)
        this._iceFailureRecoveryTimer = null;
        this._startIceFailureRecoveryTimeout()
      }
      this._iceGatheringComplete = false // Reset iceComplete
      clearTimeout(this._iceGatheringCompleteTimer) // Clear _iceGatheringCompleteTimer too
      this._iceGatheringCompleteTimer = null // Clear _iceGatheringCompleteTimer too
      this._isNegotiating = false // allow renegotiation and createOffer to happen
      this._isRestartingIce = true;
      if (this._pc.restartIce) this._pc.restartIce()
      this._needsNegotiation() // Start a new negotiating cycle
      return true
    }
  }

  /**
   * calls __destroy() after the iceFailureRecoveryTimeout time if we dont
   * re-establish connection (this function is called once ice enters the failed state)
   **/
  _startIceFailureRecoveryTimeout () {
    if (this.destroyed || this._destroying) return
    if (this._iceFailureRecoveryTimer != null) return
    this._debug('started iceFailureRecovery timeout')
    this._iceGatheringComplete = false // Reset iceComplete
    clearTimeout(this._iceGatheringCompleteTimer) // Clear _iceGatheringCompleteTimer too
    this._iceGatheringCompleteTimer = null // Clear _iceGatheringCompleteTimer too
    this._iceFailureRecoveryTimer = setTimeout(() => {
      const iceConnectionState = this._pc.iceConnectionState
      const iceGatheringState = this._pc.iceGatheringState
      this._debug('checking iceFailureRecovery timeout', iceConnectionState, iceGatheringState, this._iceGatheringComplete)
      let hasFailedToRecover = !(iceConnectionState === 'connected' || iceConnectionState === 'completed')
      if (hasFailedToRecover) {
        this._debug('iceFailureRecovery timeout completed - failed')
        this.__destroy(errCode(new Error('Ice connection recovery failed.'), 'ERR_ICE_CONNECTION_FAILURE'))
      }
    }, this.iceFailureRecoveryTimeout)
  }


  _final (cb) {
    if (!this._readableState.ended) this.push(null)
    cb(null)
  }

  __destroy (err) {
    this.end()
    this._destroy(() => { }, err)
  }

  _destroy (cb, err) {
    if (this.destroyed || this._destroying) return
    this._destroying = true

    this._debug('destroying (error: %s)', err && (err.message || err))

    setTimeout(() => { // allow events concurrent with the call to _destroy() to fire (see #692)
      this._connected = false
      this._pcReady = false
      this._channelReady = false
      this._remoteTracks = null
      this._remoteStreams = null
      this._senderMap = null

      clearInterval(this._closingInterval)
      this._closingInterval = null

      clearInterval(this._interval)
      this._interval = null
      this._chunk = null
      this._cb = null

      if (this._onFinishBound) this.removeListener('finish', this._onFinishBound)
      this._onFinishBound = null

      if (this._channel) {
        try {
          this._channel.close()
        } catch (err) { }

        // allow events concurrent with destruction to be handled
        this._channel.onmessage = null
        this._channel.onopen = null
        this._channel.onclose = null
        this._channel.onerror = null
      }
      if (this._pc) {
        try {
          this._pc.close()
        } catch (err) { }

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

  _setupData (event) {
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

    this._channel.onmessage = event => {
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
    this._channel.onerror = event => {
      const err = event.error instanceof Error
        ? event.error
        : new Error(`Datachannel error: ${event.message} ${event.filename}:${event.lineno}:${event.colno}`)
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

  _write (chunk, cb) {
    if (this.destroyed) return cb(errCode(new Error('cannot write after peer is destroyed'), 'ERR_DATA_CHANNEL'))

    if (this._connected) {
      try {
        this.send(chunk)
      } catch (err) {
        return this.__destroy(errCode(err, 'ERR_DATA_CHANNEL'))
      }
      if (this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        this._debug('start backpressure: bufferedAmount %d', this._channel.bufferedAmount)
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

  /** When stream finishes writing, close socket. Half open connections are not
   supported. */
  _onFinish () {
    if (this.destroyed) return

    // Wait a bit before destroying so the socket flushes.
    // TODO: is there a more reliable way to accomplish this?
    const destroySoon = () => {
      setTimeout(() => this.__destroy(), 1000)
    }

    if (this._connected) {
      destroySoon()
    } else {
      this.once('connect', destroySoon)
    }
  }

  _startIceCompleteTimeout () {
    if (this.destroyed) return
    if (this._iceGatheringCompleteTimer) return
    this._debug('started iceComplete timeout')
    this._iceGatheringCompleteTimer = setTimeout(() => {
      if (!this._iceGatheringComplete) {
        this._debug('iceComplete timeout completed')
        this.emit('iceTimeout')
        this._onIceGatheringComplete();
      }
    }, this.iceCompleteTimeout)
  }

  _createOffer () {
    if (this.destroyed) return

    const offerOptions = Object.assign({}, this.offerOptions) // copy offer options
    if (this._isRestartingIce) this.offerOptions.iceRestart = true

    this._pc.createOffer(offerOptions)
      .then(offer => {
        if (this.destroyed) return
        if (!this.trickle && !this.allowHalfTrickle) offer.sdp = filterTrickle(offer.sdp)
        offer.sdp = this.sdpTransform(offer.sdp)

        const sendOffer = () => {
          if (this.destroyed) return
          const signal = this._pc.localDescription || offer
          this._debug('signal')
          this.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          })
        }

        const onSuccess = () => {
          this._debug('createOffer success')
          if (this.destroyed) return
          if (this.trickle || this._iceGatheringComplete) sendOffer()
          else this.once('_iceGatheringComplete', sendOffer) // wait for candidates
        }

        const onError = err => {
          this.__destroy(errCode(err, 'ERR_SET_LOCAL_DESCRIPTION'))
        }

        this._pc.setLocalDescription(offer)
          .then(onSuccess)
          .catch(onError)
      })
      .catch(err => {
        this.__destroy(errCode(err, 'ERR_CREATE_OFFER'))
      })
  }

  _createAnswer () {
    if (this.destroyed) return

    this._pc.createAnswer(this.answerOptions)
      .then(answer => {
        if (this.destroyed) return
        if (!this.trickle && !this.allowHalfTrickle) answer.sdp = filterTrickle(answer.sdp)
        answer.sdp = this.sdpTransform(answer.sdp)

        const sendAnswer = () => {
          if (this.destroyed) return
          const signal = this._pc.localDescription || answer
          this._debug('signal')
          this.emit('signal', {
            type: signal.type,
            sdp: signal.sdp
          })
          if (!this.initiator) this._requestMissingTransceivers?.()
        }

        const onSuccess = () => {
          if (this.destroyed) return
          if (this.trickle || this._iceGatheringComplete) sendAnswer()
          else this.once('_iceGatheringComplete', sendAnswer)
        }

        const onError = err => {
          this.__destroy(errCode(err, 'ERR_SET_LOCAL_DESCRIPTION'))
        }

        this._pc.setLocalDescription(answer)
          .then(onSuccess)
          .catch(onError)
      })
      .catch(err => {
        this.__destroy(errCode(err, 'ERR_CREATE_ANSWER'))
      })
  }

  _onConnectionStateChange () {
    if (this.destroyed || this._destroying) return
    this._debug('_onConnectionStateChange ' + this._pc.connectionState)

    if (this._pc.connectionState !== "connected") {
      this._connected = false
    }

    if (this._pc.connectionState === 'failed') {
      if (this.iceRestartEnabled || this._isRestartingIce) {
        this._startIceFailureRecoveryTimeout()
      } else {
        return this.__destroy(errCode(new Error('Connection failed.'), 'ERR_CONNECTION_FAILURE'))
      }
    }

    if (
      (this._pc.connectionState === 'failed' && this.iceRestartEnabled === 'onFailure') ||
      (this._pc.connectionState === 'disconnected' && this.iceRestartEnabled === 'onDisconnect')
    ) {
      if (this.initiator && !this._isRestartingIce) {
        this.restartIce()
      }
    }
  }

  _onIceStateChange () {
    if (this.destroyed) return
    const iceConnectionState = this._pc.iceConnectionState
    const iceGatheringState = this._pc.iceGatheringState

    this._debug(
      'iceStateChange (connection: %s) (gathering: %s)',
      iceConnectionState,
      iceGatheringState
    )
    this.emit('iceStateChange', iceConnectionState, iceGatheringState)

    if (iceGatheringState === 'complete') {
      this._onIceGatheringComplete();
    }

    if (iceConnectionState === 'connected' || iceConnectionState === 'completed') {
      if (this._iceFailureRecoveryTimer != null) {
        clearTimeout(this._iceFailureRecoveryTimer)
        this._iceFailureRecoveryTimer = null
      }
      this._pcReady = true
      this._isRestartingIce = false
      this._maybeReady()
    }

    if (iceConnectionState === 'closed') {
      this.__destroy(errCode(new Error('Ice connection closed.'), 'ERR_ICE_CONNECTION_CLOSED'))
    } else if (iceConnectionState === 'failed' && !this.iceRestartEnabled && !this._isRestartingIce) {
      this.__destroy(errCode(new Error('Ice connection failed.'), 'ERR_ICE_CONNECTION_FAILURE'))
    } else if (iceConnectionState === 'failed' && (this.iceRestartEnabled || this._isRestartingIce)) {
      this._startIceFailureRecoveryTimeout()
    }

    if (
      (iceConnectionState === 'failed' && this.iceRestartEnabled === 'onFailure') ||
      (iceConnectionState === 'disconnected' && this.iceRestartEnabled === 'onDisconnect')
    ) {
      if (this.initiator && !this._isRestartingIce) {
        this.restartIce()
      }
    }
  }

  _onIceGatheringComplete () {
    if (!this._iceGatheringComplete) {
      this._debug('iceGatheringComplete')
      this._iceGatheringComplete = true
      this.emit('_iceGatheringComplete')
      clearTimeout(this._iceGatheringCompleteTimer)
      this._iceGatheringCompleteTimer = null
    }
  }

  getStats (cb) {
    // statreports can come with a value array instead of properties
    const flattenValues = report => {
      if (Object.prototype.toString.call(report.values) === '[object Array]') {
        report.values.forEach(value => {
          Object.assign(report, value)
        })
      }
      return report
    }

    // Promise-based getStats() (standard)
    if (this._pc.getStats.length === 0 || this._isReactNativeWebrtc) {
      this._pc.getStats()
        .then(res => {
          const reports = []
          res.forEach(report => {
            reports.push(flattenValues(report))
          })
          cb(null, reports)
        }, err => cb(err))

      // Single-parameter callback-based getStats() (non-standard)
    } else if (this._pc.getStats.length > 0) {
      this._pc.getStats(res => {
        // If we destroy connection in `connect` callback this code might happen to run when actual connection is already closed
        if (this.destroyed) return

        const reports = []
        res.result().forEach(result => {
          const report = {}
          result.names().forEach(name => {
            report[name] = result.stat(name)
          })
          report.id = result.id
          report.type = result.type
          report.timestamp = result.timestamp
          reports.push(flattenValues(report))
        })
        cb(null, reports)
      }, err => cb(err))

      // Unknown browser, skip getStats() since it's anyone's guess which style of
      // getStats() they implement.
    } else {
      cb(null, [])
    }
  }

  _maybeReady () {
    this._debug('maybeReady pc %s channel %s', this._pcReady, this._channelReady)
    if (this._connecting || !this._pcReady || !this._channelReady) return

    this._connecting = true

    // HACK: We can't rely on order here, for details see https://github.com/js-platform/node-webrtc/issues/339
    const findCandidatePair = () => {
      if (this.destroyed || this._destroying) return

      this.getStats((err, items) => {
        if (this.destroyed || this._destroying) return

        // Treat getStats error as non-fatal. It's not essential.
        if (err) items = []

        const remoteCandidates = {}
        const localCandidates = {}
        const candidatePairs = {}
        let foundSelectedCandidatePair = false

        items.forEach(item => {
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

        const setSelectedCandidatePair = selectedCandidatePair => {
          foundSelectedCandidatePair = true

          let local = localCandidates[selectedCandidatePair.localCandidateId]

          if (local && (local.ip || local.address)) {
            // Spec
            this.localAddress = local.ip || local.address
            this.localPort = Number(local.port)
          } else if (local && local.ipAddress) {
            // Firefox
            this.localAddress = local.ipAddress
            this.localPort = Number(local.portNumber)
          } else if (typeof selectedCandidatePair.googLocalAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            local = selectedCandidatePair.googLocalAddress.split(':')
            this.localAddress = local[0]
            this.localPort = Number(local[1])
          }
          if (this.localAddress) {
            this.localFamily = this.localAddress.includes(':') ? 'IPv6' : 'IPv4'
          }

          let remote = remoteCandidates[selectedCandidatePair.remoteCandidateId]

          if (remote && (remote.ip || remote.address)) {
            // Spec
            this.remoteAddress = remote.ip || remote.address
            this.remotePort = Number(remote.port)
          } else if (remote && remote.ipAddress) {
            // Firefox
            this.remoteAddress = remote.ipAddress
            this.remotePort = Number(remote.portNumber)
          } else if (typeof selectedCandidatePair.googRemoteAddress === 'string') {
            // TODO: remove this once Chrome 58 is released
            remote = selectedCandidatePair.googRemoteAddress.split(':')
            this.remoteAddress = remote[0]
            this.remotePort = Number(remote[1])
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

        items.forEach(item => {
          // Spec-compliant
          if (item.type === 'transport' && item.selectedCandidatePairId) {
            setSelectedCandidatePair(candidatePairs[item.selectedCandidatePairId])
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
        }

        if (this._chunk) {
          try {
            this.send(this._chunk)
          } catch (err) {
            return this.__destroy(errCode(err, 'ERR_DATA_CHANNEL'))
          }
          this._chunk = null
          this._debug('sent chunk from "write before connect"')

          const cb = this._cb
          this._cb = null
          cb(null)
        }

        if (!this._connectedOnce) {
          this._connectedOnce = true

          // If `bufferedAmountLowThreshold` and 'onbufferedamountlow' are unsupported,
          // fallback to using setInterval to implement backpressure.
          if (typeof this._channel.bufferedAmountLowThreshold !== 'number') {
            this._interval = setInterval(() => this._onInterval(), 150)
            if (this._interval.unref) this._interval.unref()
          }

          this._debug('connect')
          this.emit('connect')
        } else {
          this._debug('reconnect')
          this.emit('reconnect')
        }
      })
    }
    findCandidatePair()
  }

  _onInterval () {
    if (!this._cb || !this._channel || this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      return
    }
    this._onChannelBufferedAmountLow()
  }

  _onSignalingStateChange () {
    if (this.destroyed) return

    if (this._pc.signalingState === 'stable') {
      this._isNegotiating = false

      // HACK: Firefox doesn't yet support removing tracks when signalingState !== 'stable'
      this._debug('flushing sender queue', this._sendersAwaitingStable)
      this._sendersAwaitingStable.forEach(sender => {
        this._pc.removeTrack(sender)
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

    this._debug('signalingStateChange %s', this._pc.signalingState)
    this.emit('signalingStateChange', this._pc.signalingState)
  }

  _onIceCandidate (event) {
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
    } else if (!event.candidate && !this._iceGatheringComplete) {
      // a null ICE candidate indicates that the ice gathering process is finished
      this._onIceGatheringComplete()
    }
    // as soon as we've received one valid candidate start timeout
    if (event.candidate) {
      this._startIceCompleteTimeout()
    }
  }

  _onChannelMessage (event) {
    if (this.destroyed) return
    let data = event.data
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data)
    } else if (this.__objectMode === false) {
      data = text2arr(data)
    }
    this.push(data)
  }

  _onChannelBufferedAmountLow () {
    if (this.destroyed || !this._cb) return
    this._debug('ending backpressure: bufferedAmount %d', this._channel.bufferedAmount)
    const cb = this._cb
    this._cb = null
    cb(null)
  }

  _onChannelOpen () {
    if (this._connected || this.destroyed) return
    this._debug('on channel open')
    this._channelReady = true
    this._maybeReady()
  }

  _onChannelClose () {
    if (this.destroyed) return
    this._debug('on channel close')
    this.__destroy()
  }

  _debug () {
    const args = [].slice.call(arguments)
    args[0] = '[' + this._id + '] ' + args[0]
    Debug.apply(null, args)
  }
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
  ],
  sdpSemantics: 'unified-plan'
}

Peer.channelConfig = {}

export default Peer
