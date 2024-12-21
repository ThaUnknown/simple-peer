/*! simple-peer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
import Lite from './lite.js'
import type { PeerOpts } from './lite.js'
import errCode from 'err-code'
export type { SignalEvent } from './lite.js'

/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few
 * extra methods.
 *
 * Duplex stream.
 *
 * @param {Partial<{ streams, stream }> & PeerOpts} opts
 */
export class Peer extends Lite {
    streams?:MediaStream[]

    constructor (opts:(Partial<{ streams, stream }> & Partial<PeerOpts>) = {}) {
        super(opts)
        if (!this._pc) return

        // support old "stream" option
        this.streams = opts.streams || (opts.stream ? [opts.stream] : [])
        this._senderMap = new Map()

        if (this.streams) {
            this.streams.forEach(stream => {
                this.addStream(stream)
            })
        }
        this._pc.ontrack = event => {
            this._onTrack(event)
        }
    }

    /**
     * Add a Transceiver to the connection.
     * @param {String} kind
     * @param {Object=} init
     */
    addTransceiver (kind:string, init = {}) {
        if (this._destroying) return
        if (this.destroyed) {
            throw errCode(
                new Error('cannot addTransceiver after peer is destroyed'),
                'ERR_DESTROYED'
            )
        }
        this._debug('addTransceiver()')

        if (this.initiator) {
            try {
                this._pc?.addTransceiver(kind, init)
                this._needsNegotiation()
            } catch (err) {
                this.__destroy(errCode(err, 'ERR_ADD_TRANSCEIVER'))
            }
        } else {
            this.emit('signal', {  // request initiator to renegotiate
                type: 'transceiverRequest',
                transceiverRequest: { kind, init }
            })
        }
    }

    /**
     * Add a MediaStream to the connection.
     *
     * @param {MediaStream} stream
     */
    addStream (stream:MediaStream) {
        if (this._destroying) return
        if (this.destroyed) {
            throw errCode(
                new Error('cannot addStream after peer is destroyed'),
                'ERR_DESTROYED'
            )
        }
        this._debug('addStream()')

        stream.getTracks().forEach(track => {
            this.addTrack(track, stream)
        })
    }

    /**
     * Add a MediaStreamTrack to the connection.
     * @param {MediaStreamTrack} track
     * @param {MediaStream} stream
     */
    addTrack (track, stream) {
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
            throw errCode(new Error(
                'Track has been removed. You should enable/disable tracks ' +
                    'that you want to re-add.'
            ), 'ERR_SENDER_REMOVED')
        } else {
            throw errCode(new Error(
                'Track has already been added to that stream.'
            ), 'ERR_SENDER_ALREADY_ADDED')
        }
    }

    /**
     * Replace a MediaStreamTrack by another in the connection.
     * @param {MediaStreamTrack} oldTrack
     * @param {MediaStreamTrack} newTrack
     * @param {MediaStream} stream
     */
    replaceTrack (
        oldTrack:MediaStreamTrack,
        newTrack:MediaStreamTrack,
        stream:MediaStream
    ) {
        if (this._destroying) return
        if (this.destroyed) {
            throw errCode(new Error(
                'cannot replaceTrack after peer is destroyed'
            ), 'ERR_DESTROYED')
        }
        this._debug('replaceTrack()')

        const submap = this._senderMap?.get(oldTrack)
        const sender = submap ? submap.get(stream) : null
        if (!sender) {
            throw errCode(new Error(
                'Cannot replace track that was never added.'
            ), 'ERR_TRACK_NOT_ADDED')
        }
        if (newTrack) this._senderMap?.set(newTrack, submap)

        if (sender.replaceTrack != null) {
            sender.replaceTrack(newTrack)
        } else {
            this.__destroy(errCode(new Error(
                'replaceTrack is not supported in this browser'
            ), 'ERR_UNSUPPORTED_REPLACETRACK'))
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
    removeStream (stream:MediaStream) {
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

    _requestMissingTransceivers () {
        if (this._pc?.getTransceivers) {
            this._pc.getTransceivers().forEach(transceiver => {
                if (
                    !transceiver.mid &&
                    transceiver.sender.track &&
                    // @ts-expect-error ???
                    !transceiver.requested
                ) {
                    // HACK: Safari returns negotiated transceivers with a
                    // null mid
                    // @ts-expect-error ???
                    transceiver.requested = true
                    this.addTransceiver(transceiver.sender.track.kind)
                }
            })
        }
    }

    _onTrack (event:RTCTrackEvent) {
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
            })) {
                // Only fire one 'stream' event, even though there may
                // be multiple tracks per stream
                return
            }

            this._remoteStreams?.push(eventStream)

            queueMicrotask(() => {
                this._debug('on stream')
                // ensure all tracks have been added
                this.emit('stream', eventStream)
            })
        })
    }
}

export default Peer
