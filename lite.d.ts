import { RTCPeerConnection, RTCDataChannel, RTCDataChannelEvent, RTCPeerConnectionIceEvent, MediaStream, MediaStreamTrack } from 'webrtc-polyfill';
import { Duplex, DuplexEvents, Callback } from 'streamx';
interface SignalData {
    type?: string;
    sdp?: string;
    candidate?: RTCIceCandidateInit;
    renegotiate?: boolean;
    transceiverRequest?: {
        kind: string;
        init?: Record<string, unknown>;
    };
}
interface PeerOptions {
    initiator?: boolean;
    channelConfig?: RTCDataChannelInit;
    channelName?: string;
    config?: RTCConfiguration;
    offerOptions?: RTCOfferOptions;
    answerOptions?: RTCAnswerOptions;
    sdpTransform?: (sdp: string) => string;
    streams?: MediaStream[];
    stream?: MediaStream;
    trickle?: boolean;
    allowHalfTrickle?: boolean;
    iceCompleteTimeout?: number;
    objectMode?: boolean;
    allowHalfOpen?: boolean;
}
interface AddressInfo {
    port: number | undefined;
    family: string | undefined;
    address: string | undefined;
}
interface StatsReport {
    id: string;
    type: string;
    timestamp: number;
    values?: Record<string, unknown>[];
    localCandidateId?: string;
    remoteCandidateId?: string;
    selectedCandidatePairId?: string;
    googLocalAddress?: string;
    googRemoteAddress?: string;
    googActiveConnection?: string;
    selected?: boolean;
    ip?: string;
    address?: string;
    port?: number;
    ipAddress?: string;
    portNumber?: number;
    [key: string]: unknown;
}
interface PeerEvents extends DuplexEvents<Uint8Array, Uint8Array> {
    signal: (data: SignalData) => void;
    connect: () => void;
    disconnect: () => void;
    iceStateChange: (iceConnectionState: RTCIceConnectionState, iceGatheringState: RTCIceGatheringState) => void;
    signalingStateChange: (signalingState: RTCSignalingState) => void;
    negotiated: () => void;
    iceTimeout: () => void;
    _iceComplete: () => void;
    track?: (track: MediaStreamTrack, stream: MediaStream) => void;
    stream?: (stream: MediaStream) => void;
}
/**
 * WebRTC peer connection. Same API as node core `net.Socket`, plus a few extra methods.
 * Duplex stream.
 */
declare class Peer extends Duplex<Uint8Array, Uint8Array, Uint8Array, Uint8Array, true, true, PeerEvents> {
    _pc: RTCPeerConnection | null;
    _id: string;
    channelName: string | null;
    initiator: boolean;
    channelConfig: RTCDataChannelInit;
    channelNegotiated: boolean;
    config: RTCConfiguration;
    offerOptions: RTCOfferOptions;
    answerOptions: RTCAnswerOptions;
    sdpTransform: (sdp: string) => string;
    trickle: boolean;
    allowHalfTrickle: boolean;
    iceCompleteTimeout: number;
    _destroying: boolean;
    _connected: boolean;
    remoteAddress: string | undefined;
    remoteFamily: string | undefined;
    remotePort: number | undefined;
    localAddress: string | undefined;
    localFamily: string | undefined;
    localPort: number | undefined;
    _pcReady: boolean;
    _channelReady: boolean;
    _iceComplete: boolean;
    _iceCompleteTimer: ReturnType<typeof setTimeout> | null;
    _channel: RTCDataChannel | null;
    _pendingCandidates: RTCIceCandidateInit[];
    _isNegotiating: boolean;
    _firstNegotiation: boolean;
    _batchedNegotiation: boolean;
    _queuedNegotiation: boolean;
    _sendersAwaitingStable: RTCRtpSender[];
    _closingInterval: ReturnType<typeof setInterval> | null;
    _remoteTracks: Array<{
        track: MediaStreamTrack;
        stream: MediaStream;
    }> | null;
    _remoteStreams: MediaStream[] | null;
    _chunk: Uint8Array | null;
    _cb: Callback | null;
    _interval: ReturnType<typeof setInterval> | null;
    _isReactNativeWebrtc: boolean;
    _connecting: boolean;
    _onFinishBound: (() => void) | null;
    __objectMode: boolean;
    static WEBRTC_SUPPORT: boolean;
    static config: RTCConfiguration;
    static channelConfig: RTCDataChannelInit;
    constructor(opts?: PeerOptions);
    get bufferSize(): number;
    get connected(): boolean;
    address(): AddressInfo;
    signal(data: SignalData | string): void;
    _addIceCandidate(candidate: RTCIceCandidateInit): void;
    /**
     * Send text/binary data to the remote peer.
     */
    send(chunk: ArrayBufferView | ArrayBuffer | Uint8Array | string | Blob): void;
    _needsNegotiation(): void;
    negotiate(): void;
    _final(cb: Callback): void;
    __destroy(err?: Error | null): void;
    _destroy(cb: Callback, err?: Error | null): void;
    _setupData(event: RTCDataChannelEvent): void;
    _write(chunk: Uint8Array, cb: Callback): void;
    _onFinish(): void;
    _startIceCompleteTimeout(): void;
    _createOffer(): void;
    _createAnswer(): void;
    _onConnectionStateChange(): void;
    _onIceStateChange(): void;
    getStats(cb: (err: Error | null, reports?: StatsReport[]) => void): void;
    _maybeReady(): void;
    _onInterval(): void;
    _onSignalingStateChange(): void;
    _onIceCandidate(event: RTCPeerConnectionIceEvent): void;
    _onChannelMessage(event: MessageEvent): void;
    _onChannelBufferedAmountLow(): void;
    _onChannelOpen(): void;
    _onChannelClose(): void;
    _debug(...args: unknown[]): void;
    addTransceiver?(kind: string, init?: Record<string, unknown>): void;
    _requestMissingTransceivers?(): void;
}
export default Peer;
export { Peer, PeerOptions, SignalData, AddressInfo, StatsReport };
//# sourceMappingURL=lite.d.ts.map