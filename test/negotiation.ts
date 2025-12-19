import common from './common.js'
import Peer from '../index.js'
import { test, expect } from 'vitest'

test('single negotiation', function () {
  if (!process.browser) return

  return new Promise<void>((resolve, reject) => {
    const peer1 = new Peer({ initiator: true, stream: common.getMediaStream() })
    const peer2 = new Peer({ stream: common.getMediaStream() })

    peer1.on('signal', function (data) {
      if (data.renegotiate) reject(new Error('got unexpected request to renegotiate'))
      if (!peer2.destroyed) peer2.signal(data)
    })
    peer2.on('signal', function (data) {
      if (data.renegotiate) reject(new Error('got unexpected request to renegotiate'))
      if (!peer1.destroyed) peer1.signal(data)
    })

    let connectCount = 0
    let streamCount = 0
    let trackCount1 = 0
    let trackCount2 = 0
    
    const checkComplete = () => {
      if (connectCount >= 2 && streamCount >= 2 && trackCount1 >= 2 && trackCount2 >= 2) {
        resolve()
      }
    }

    peer1.on('connect', function () {
      connectCount++
      checkComplete()
    })
    peer2.on('connect', function () {
      connectCount++
      checkComplete()
    })

    peer1.on('stream', function (stream) {
      streamCount++
      checkComplete()
    })
    peer2.on('stream', function (stream) {
      streamCount++
      checkComplete()
    })

    peer1.on('track', function (track) {
      trackCount1++
      if (trackCount1 >= 2) {
        checkComplete()
      }
    })
    peer2.on('track', function (track) {
      trackCount2++
      if (trackCount2 >= 2) {
        checkComplete()
      }
    })
  })
})

test('manual renegotiation', function () {
  if (!process.browser) return

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    let negotiatedCount = 0
    const checkComplete = () => {
      if (negotiatedCount >= 2) {
        resolve()
      }
    }

    peer1.on('connect', function () {
      peer1.negotiate()

      peer1.on('negotiated', function () {
        negotiatedCount++
        checkComplete()
      })
      peer2.on('negotiated', function () {
        negotiatedCount++
        checkComplete()
      })
    })
  })
})

// Note: This test is flaky in headless browsers due to WebRTC limitations with repeated renegotiations
test.skip('repeated manual renegotiation', { timeout: 60000 }, function () {
  if (!process.browser) return

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    let peer1Negotiated = 0
    let peer2Negotiated = 0

    peer1.once('connect', function () {
      peer1.negotiate()
    })
    peer1.on('negotiated', function () {
      peer1Negotiated++
      if (peer1Negotiated === 1) {
        peer1.negotiate()
      } else if (peer1Negotiated === 2) {
        peer1.negotiate()
      } else if (peer1Negotiated === 3 && peer2Negotiated === 3) {
        resolve()
      }
    })
    peer2.on('negotiated', function () {
      peer2Negotiated++
      if (peer2Negotiated === 1) {
        peer2.negotiate()
      } else if (peer2Negotiated === 2) {
        peer1.negotiate()
      } else if (peer2Negotiated === 3 && peer1Negotiated === 3) {
        resolve()
      }
    })
  })
})

test('renegotiation after addStream', function () {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    return // Skip on iOS which does not support this reliably
  }

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    let connectCount = 0
    let streamCount = 0
    
    const checkComplete = () => {
      if (connectCount >= 2 && streamCount >= 2) {
        resolve()
      }
    }

    peer1.on('connect', function () {
      connectCount++
      peer1.addStream(common.getMediaStream())
      checkComplete()
    })
    peer2.on('connect', function () {
      connectCount++
      peer2.addStream(common.getMediaStream())
      checkComplete()
    })
    peer1.on('stream', function () {
      streamCount++
      checkComplete()
    })
    peer2.on('stream', function () {
      streamCount++
      checkComplete()
    })
  })
})

test('add stream on non-initiator only', function () {
  if (!process.browser) return

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({
      initiator: true
    })
    const peer2 = new Peer({
      stream: common.getMediaStream()
    })

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    let connectCount = 0
    let gotStream = false
    
    const checkComplete = () => {
      if (connectCount >= 2 && gotStream) {
        resolve()
      }
    }

    peer1.on('connect', function () {
      connectCount++
      checkComplete()
    })
    peer2.on('connect', function () {
      connectCount++
      checkComplete()
    })
    peer1.on('stream', function () {
      gotStream = true
      checkComplete()
    })
  })
})

test('negotiated channels', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({
      initiator: true,
      channelConfig: {
        id: 1,
        negotiated: true
      }
    })
    const peer2 = new Peer({
      channelConfig: {
        id: 1,
        negotiated: true
      }
    })

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    let connectCount = 0
    peer1.on('connect', function () {
      connectCount++
      if (connectCount >= 2) resolve()
    })
    peer2.on('connect', function () {
      connectCount++
      if (connectCount >= 2) resolve()
    })
  })
})
