/*! simple-peer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
import { RTCPeerConnection } from 'webrtc-polyfill'
import { Peer as LitePeer } from './lite.js'
import errCode from 'err-code'
import { randomBytes, arr2hex } from 'uint8-util'

const MAX_BUFFERED_AMOUNT = 64 * 1024
const ICECOMPLETE_TIMEOUT = 5 * 1000

/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few extra methods.
 * Duplex stream.
 * @param {Object} opts
 */
class Peer extends LitePeer {
    streams:MediaStream[]

    constructor (opts) {
        super()
        opts = Object.assign({
            allowHalfOpen: false
        }, opts)

        super(opts)

        // streamx is objectMode by default, so implement readable's fuctionality
        this.__objectMode = !!opts.objectMode

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
        // support old "stream" option
        this.streams = opts.streams || (opts.stream ? [opts.stream] : [])
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
        this._senderMap = new Map()
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

        // Other spec events, unused by this implementation:
        // - onconnectionstatechange
        // - onicecandidateerror
        // - onfingerprintfailure
        // - onnegotiationneeded

        if (this.streams) {
            this.streams.forEach(stream => {
                this.addStream(stream)
            })
        }

        this._pc.ontrack = event => {
            this._onTrack(event)
        }

        this._debug('initial negotiation')
        this._needsNegotiation()

        this._onFinishBound = () => {
            this._onFinish()
        }
        this.once('finish', this._onFinishBound)
    }

    // HACK: it's possible channel.readyState is "closing" before peer.destroy()
    // fires https://bugs.chromium.org/p/chromium/issues/detail?id=882743
    get connected () {
        return (this._connected && this._channel?.readyState === 'open')
    }

    // /**
    //  * Send binary data to the remote peer.
    //  * @param {ArrayBufferView|ArrayBuffer|Uint8Array|string|Blob} chunk
    //  */
    // send (chunk:ArrayBuffer|Uint8Array) {
    //     if (this._destroying) return
    //     if (this.destroyed) {
    //         throw errCode(
    //             new Error('cannot send after peer is destroyed'),
    //             'ERR_DESTROYED'
    //         )
    //     }
    //     this._channel?.send(chunk)
    // }

    // /**
    //  * Add a Transceiver to the connection.
    //  * @param {String} kind
    //  * @param {Object} init
    //  */
    // addTransceiver (kind, init) {
    //     if (this._destroying) return
    //     if (this.destroyed) throw errCode(new Error('cannot addTransceiver after peer is destroyed'), 'ERR_DESTROYED')
    //     this._debug('addTransceiver()')

    //     if (this.initiator) {
    //         try {
    //             this._pc.addTransceiver(kind, init)
    //             this._needsNegotiation()
    //         } catch (err) {
    //             this.__destroy(errCode(err, 'ERR_ADD_TRANSCEIVER'))
    //         }
    //     } else {
    //         this.emit('signal', { // request initiator to renegotiate
    //             type: 'transceiverRequest',
    //             transceiverRequest: { kind, init }
    //         })
    //     }
    // }

    /**
     * Add a MediaStream to the connection.
     * @param {MediaStream} stream
     */
    addStream (stream) {
        if (this._destroying) return
        if (this.destroyed) throw errCode(new Error('cannot addStream after peer is destroyed'), 'ERR_DESTROYED')
        this._debug('addStream()')

        stream.getTracks().forEach(track => {
            this.addTrack(track, stream)
        })
    }

    /**
     * Add a MediaStreamTrack to the connection.
     */
    addTrack (track:MediaStreamTrack, stream:MediaStream):void {
        if (this._destroying) return
        if (this.destroyed) {
            throw errCode(
                new Error('cannot addTrack after peer is destroyed'),
                'ERR_DESTROYED'
            )
        }
        this._debug('addTrack()')

        // nested Maps map [track, stream] to sender
        const submap = this._senderMap?.get(track) || new Map()
        let sender = submap.get(stream)
        if (!sender) {
            sender = this._pc?.addTrack(track, stream)
            submap.set(stream, sender)
            this._senderMap?.set(track, submap)
            this._needsNegotiation()
        } else if (sender.removed) {
            throw errCode(
                new Error(
                    'Track has been removed. You should enable/disable ' +
                    'tracks that you want to re-add.'
                ),
                'ERR_SENDER_REMOVED'
            )
        } else {
            throw errCode(
                new Error('Track has already been added to that stream.'),
                'ERR_SENDER_ALREADY_ADDED'
            )
        }
    }

    /**
     * Replace a MediaStreamTrack by another in the connection.
     */
    replaceTrack (
        oldTrack:MediaStreamTrack,
        newTrack:MediaStreamTrack,
        stream:MediaStream
    ):void {
        if (this._destroying) return
        if (this.destroyed) throw errCode(new Error('cannot replaceTrack after peer is destroyed'), 'ERR_DESTROYED')
        this._debug('replaceTrack()')

        const submap = this._senderMap?.get(oldTrack)
        const sender = submap ? submap.get(stream) : null
        if (!sender) {
            throw errCode(new Error('Cannot replace track that was never added.'), 'ERR_TRACK_NOT_ADDED')
        }
        if (newTrack) this._senderMap?.set(newTrack, submap)

        if (sender.replaceTrack != null) {
            sender.replaceTrack(newTrack)
        } else {
            this.__destroy(errCode(new Error('replaceTrack is not supported in this browser'), 'ERR_UNSUPPORTED_REPLACETRACK'))
        }
    }

    /**
     * Remove a MediaStreamTrack from the connection.
     * @param {MediaStreamTrack} track
     * @param {MediaStream} stream
     */
    removeTrack (track:MediaStreamTrack, stream:MediaStream):void {
        if (this._destroying) return
        if (this.destroyed) {
            throw errCode(
                new Error('cannot removeTrack after peer is destroyed'),
                'ERR_DESTROYED'
            )
        }
        this._debug('removeSender()')

        const submap = this._senderMap?.get(track)
        const sender = submap ? submap.get(stream) : null
        if (!sender) {
            throw errCode(
                new Error('Cannot remove track that was never added.'),
                'ERR_TRACK_NOT_ADDED'
            )
        }
        try {
            sender.removed = true
            this._pc?.removeTrack(sender)
        } catch (_err) {
            const err = _err as Error
            if (err.name === 'NS_ERROR_UNEXPECTED') {
                // HACK: Firefox must wait until (signalingState === stable)
                // https://bugzilla.mozilla.org/show_bug.cgi?id=1133874
                this._sendersAwaitingStable.push(sender)
            } else {
                this.__destroy(errCode(err, 'ERR_REMOVE_TRACK'))
            }
        }
        this._needsNegotiation()
    }

    /**
     * Remove a MediaStream from the connection.
     */
    removeStream (stream:MediaStream):void {
        if (this._destroying) return
        if (this.destroyed) {
            throw errCode(
                new Error('cannot removeStream after peer is destroyed'),
                'ERR_DESTROYED'
            )
        }
        this._debug('removeSenders()')

        stream.getTracks().forEach(track => {
            this.removeTrack(track, stream)
        })
    }

    _write (chunk, cb) {
        if (this.destroyed) return cb(errCode(new Error('cannot write after peer is destroyed'), 'ERR_DATA_CHANNEL'))

        if (this._connected) {
            try {
                this.send(chunk)
            } catch (err) {
                return this.__destroy(errCode(err, 'ERR_DATA_CHANNEL'))
            }

            if (
                this._channel &&
                this._channel.bufferedAmount > MAX_BUFFERED_AMOUNT
            ) {
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

    // When stream finishes writing, close socket. Half open connections are not
    // supported.
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

    _requestMissingTransceivers () {
        if (this._pc?.getTransceivers) {
            this._pc?.getTransceivers().forEach(transceiver => {
                if (
                    !transceiver.mid &&
                    transceiver.sender.track &&
                    // @ts-expect-error ???
                    !transceiver.requested
                ) {
                    // HACK: Safari returns negotiated transceivers
                    // with a null mid
                    // @ts-expect-error ???
                    transceiver.requested = true
                    this.addTransceiver(transceiver.sender.track.kind)
                }
            })
        }
    }

    _onTrack (event) {
        if (this.destroyed) return

        event.streams.forEach(eventStream => {
            this._debug('on track')
            this.emit('track', event.track, eventStream)

            this._remoteTracks?.push({
                track: event.track,
                stream: eventStream
            })

            if (this._remoteStreams?.some(remoteStream => {
                return remoteStream.id === eventStream.id
            })) return // Only fire one 'stream' event, even though there may be multiple tracks per stream

            this._remoteStreams?.push(eventStream)
            queueMicrotask(() => {
                this._debug('on stream')
                this.emit('stream', eventStream) // ensure all tracks have been added
            })
        })
    }
}

export default Peer
