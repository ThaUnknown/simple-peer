import common from './common.js'
import Peer from '../index.js'
import { test, expect } from 'vitest'

test('detect WebRTC support', function () {
  expect(Peer.WEBRTC_SUPPORT).toBe(true)
})

test('create peer without options', function () {
  let peer: Peer | undefined
  expect(() => {
    peer = new Peer()
    peer.destroy()
  }).not.toThrow()
})

test('signal event gets emitted', function () {
  return new Promise<void>((resolve) => {
    const peer = new Peer({ initiator: true })
    peer.once('signal', function () {
      peer.on('close', function () { 
        resolve()
      })
      peer.destroy()
    })
  })
})

test('signal event does not get emitted by non-initiator', function () {
  return new Promise<void>((resolve, reject) => {
    const peer = new Peer({ initiator: false })
    peer.once('signal', function () {
      peer.on('close', function () { reject(new Error('got signal event')) })
      peer.destroy()
    })

    setTimeout(() => {
      resolve()
    }, 1000)
  })
})

test('data send/receive text', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()

    let numSignal1 = 0
    peer1.on('signal', function (data) {
      numSignal1 += 1
      peer2.signal(data)
    })

    let numSignal2 = 0
    peer2.on('signal', function (data) {
      numSignal2 += 1
      peer1.signal(data)
    })

    peer1.on('connect', tryTest)
    peer2.on('connect', tryTest)

    function tryTest () {
      if (!peer1.connected || !peer2.connected) return

      expect(numSignal1).toBeGreaterThanOrEqual(1)
      expect(numSignal2).toBeGreaterThanOrEqual(1)
      expect(peer1.initiator).toBe(true)
      expect(peer2.initiator).toBe(false)

      peer1.send('sup peer2')
      peer2.on('data', function (data) {
        expect(ArrayBuffer.isView(data)).toBe(true)
        expect(Buffer.from(data as Uint8Array).toString()).toBe('sup peer2')

        peer2.send('sup peer1')
        peer1.on('data', function (data) {
          expect(ArrayBuffer.isView(data)).toBe(true)
          expect(Buffer.from(data as Uint8Array).toString()).toBe('sup peer1')

          peer1.on('close', function () { })
          peer1.destroy()
          peer2.on('close', function () { resolve() })
          peer2.destroy()
        })
      })
    }
  })
})

test('sdpTransform function is called', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer({ sdpTransform })

    function sdpTransform (sdp: string): string {
      expect(typeof sdp).toBe('string')
      setTimeout(function () {
        peer1.on('close', function () { })
        peer1.destroy()
        peer2.on('close', function () { resolve() })
        peer2.destroy()
      }, 0)
      return sdp
    }

    peer1.on('signal', function (data) {
      peer2.signal(data)
    })

    peer2.on('signal', function (data) {
      peer1.signal(data)
    })
  })
})

test('old constraint formats are used', function () {
  return new Promise<void>((resolve) => {
    const constraints = {
      mandatory: {
        OfferToReceiveAudio: true,
        OfferToReceiveVideo: true
      }
    }

    const peer1 = new Peer({ initiator: true, offerOptions: constraints as unknown as RTCOfferOptions })
    const peer2 = new Peer({ offerOptions: constraints as unknown as RTCOfferOptions })

    peer1.on('signal', function (data) {
      peer2.signal(data)
    })

    peer2.on('signal', function (data) {
      peer1.signal(data)
    })

    peer1.on('connect', function () {
      peer1.on('close', function () { })
      peer1.destroy()
      peer2.on('close', function () { resolve() })
      peer2.destroy()
    })
  })
})

test('new constraint formats are used', function () {
  return new Promise<void>((resolve) => {
    const constraints: RTCOfferOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    }

    const peer1 = new Peer({ initiator: true, offerOptions: constraints })
    const peer2 = new Peer({ offerOptions: constraints })

    peer1.on('signal', function (data) {
      peer2.signal(data)
    })

    peer2.on('signal', function (data) {
      peer1.signal(data)
    })

    peer1.on('connect', function () {
      peer1.on('close', function () { })
      peer1.destroy()
      peer2.on('close', function () { resolve() })
      peer2.destroy()
    })
  })
})

test('ensure remote address and port are available right after connection', function () {
  if (common.isBrowser('safari') || common.isBrowser('ios')) {
    return // Skip on Safari and iOS which do not support modern getStats() calls
  }
  if (common.isBrowser('chrome') || common.isBrowser('edge')) {
    return // Skip on Chrome and Edge which hide local IPs with mDNS
  }

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()

    peer1.on('signal', function (data) {
      peer2.signal(data)
    })

    peer2.on('signal', function (data) {
      peer1.signal(data)
    })

    peer1.on('connect', function () {
      expect(peer1.remoteAddress).toBeTruthy()
      expect(peer1.remotePort).toBeTruthy()

      peer2.on('connect', function () {
        expect(peer2.remoteAddress).toBeTruthy()
        expect(peer2.remotePort).toBeTruthy()

        peer1.on('close', function () { })
        peer1.destroy()
        peer2.on('close', function () { resolve() })
        peer2.destroy()
      })
    })
  })
})

test('ensure iceStateChange fires when connection failed', () => {
  return new Promise<void>((resolve) => {
    const peer = new Peer({ initiator: true })

    peer.once('iceStateChange', (_connectionState, _gatheringState) => {
      resolve()
    })

    // simulate concurrent iceConnectionStateChange and destroy()
    peer.destroy()
    peer._pc!.oniceconnectionstatechange!(new Event('iceconnectionstatechange'))
  })
})
