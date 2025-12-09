/*! simple-peer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
import Lite, { PeerOptions } from './lite.js';
import { MediaStream, MediaStreamTrack, RTCRtpSender } from 'webrtc-polyfill';
/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few extra methods.
 * Duplex stream.
 */
declare class Peer extends Lite {
    streams: MediaStream[];
    _senderMap: Map<MediaStreamTrack, Map<MediaStream, RTCRtpSender>> | null;
    constructor(opts?: PeerOptions);
    /**
     * Add a Transceiver to the connection.
     */
    addTransceiver(kind: string, init?: Record<string, unknown>): void;
    /**
     * Add a MediaStream to the connection.
     */
    addStream(stream: MediaStream): void;
    /**
     * Add a MediaStreamTrack to the connection.
     */
    addTrack(track: MediaStreamTrack, stream: MediaStream): void;
    /**
     * Replace a MediaStreamTrack by another in the connection.
     */
    replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack, stream: MediaStream): void;
    /**
     * Remove a MediaStreamTrack from the connection.
     */
    removeTrack(track: MediaStreamTrack, stream: MediaStream): void;
    /**
     * Remove a MediaStream from the connection.
     */
    removeStream(stream: MediaStream): void;
    _requestMissingTransceivers(): void;
    _onTrack(event: RTCTrackEvent): void;
}
export default Peer;
export { Peer };
export type { PeerOptions, SignalData, AddressInfo, StatsReport } from './lite.js';
//# sourceMappingURL=index.d.ts.map