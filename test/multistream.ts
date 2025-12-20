import common from './common.js'
import Peer from '../index.js'
import { test, expect, afterEach } from 'vitest'

let peersToCleanup: Peer[] = []

afterEach(() => {
  peersToCleanup.forEach(peer => {
    if (!peer.destroyed) {
      peer.destroy()
    }
  })
  peersToCleanup = []
})

test('multistream', function () {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    return // Skip on iOS emulator which does not support this reliably
  }

  const peer1 = new Peer({
    initiator: true,
    streams: (new Array(10)).fill(null).map(function () { return common.getMediaStream() })
  })
  const peer2 = new Peer({
    streams: (new Array(10)).fill(null).map(function () { return common.getMediaStream() })
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  const receivedIds: Record<string, boolean> = {}

  peer1.on('stream', function (stream) {
    if (receivedIds[stream.id]) {
      throw new Error('received one unique stream per event')
    } else {
      receivedIds[stream.id] = true
    }
  })
  peer2.on('stream', function (stream) {
    if (receivedIds[stream.id]) {
      throw new Error('received one unique stream per event')
    } else {
      receivedIds[stream.id] = true
    }
  })
})

test('multistream (track event)', function () {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: (new Array(5)).fill(null).map(function () { return common.getMediaStream() })
  })
  const peer2 = new Peer({
    streams: (new Array(5)).fill(null).map(function () { return common.getMediaStream() })
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  const receivedIds: Record<string, boolean> = {}

  peer1.on('track', function (track) {
    if (receivedIds[track.id]) {
      throw new Error('received one unique track per event')
    } else {
      receivedIds[track.id] = true
    }
  })
  peer2.on('track', function (track) {
    if (receivedIds[track.id]) {
      throw new Error('received one unique track per event')
    } else {
      receivedIds[track.id] = true
    }
  })
})

test('multistream on non-initiator only', function () {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: (new Array(10)).fill(null).map(function () { return common.getMediaStream() })
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) {
    if (!peer2.destroyed) peer2.signal(data)
  })
  peer2.on('signal', function (data) {
    if (!peer1.destroyed) peer1.signal(data)
  })

  const receivedIds: Record<string, boolean> = {}

  peer1.on('stream', function (stream) {
    if (receivedIds[stream.id]) {
      throw new Error('received one unique stream per event')
    } else {
      receivedIds[stream.id] = true
    }
  })
})

test('delayed stream on non-initiator', { timeout: 15000 }, function () {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    return // Skip on iOS which does not support this reliably
  }

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({
      trickle: true,
      initiator: true,
      streams: [common.getMediaStream()]
    })
    const peer2 = new Peer({
      trickle: true,
      streams: []
    })

    peersToCleanup.push(peer1, peer2)

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    setTimeout(() => {
      peer2.addStream(common.getMediaStream())
    }, 10000)
    peer1.on('stream', function () {
      resolve()
    })
  })
})

test('incremental multistream', function () {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    return // Skip on iOS emulator which does not support this reliably
  }

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    peer1.addStream(common.getMediaStream())
  })
  peer2.on('connect', function () {
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds: Record<string, boolean> = {}

  let count1 = 0
  peer1.on('stream', function (stream) {
    if (receivedIds[stream.id]) {
      throw new Error('received one unique stream per event')
    } else {
      receivedIds[stream.id] = true
    }
    count1++
    if (count1 < 5) {
      peer1.addStream(common.getMediaStream())
    }
  })

  let count2 = 0
  peer2.on('stream', function (stream) {
    if (receivedIds[stream.id]) {
      throw new Error('received one unique stream per event')
    } else {
      receivedIds[stream.id] = true
    }
    count2++
    if (count2 < 5) {
      peer2.addStream(common.getMediaStream())
    }
  })
})

test('incremental multistream (track event)', function () {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    peer1.addStream(common.getMediaStream())
  })
  peer2.on('connect', function () {
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds: Record<string, boolean> = {}

  let count1 = 0
  peer1.on('track', function (track) {
    if (receivedIds[track.id]) {
      throw new Error('received one unique track per event')
    } else {
      receivedIds[track.id] = true
    }
    count1++
    if (count1 % 2 === 0 && count1 < 10) {
      peer1.addStream(common.getMediaStream())
    }
  })

  let count2 = 0
  peer2.on('track', function (track) {
    if (receivedIds[track.id]) {
      throw new Error('received one unique track per event')
    } else {
      receivedIds[track.id] = true
    }
    count2++
    if (count2 % 2 === 0 && count2 < 10) {
      peer2.addStream(common.getMediaStream())
    }
  })
})

test('incremental multistream on non-initiator only', function () {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    return // Skip on iOS emulator which does not support this reliably
  }

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer2.on('connect', function () {
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds: Record<string, boolean> = {}

  let count = 0
  peer1.on('stream', function (stream) {
    if (receivedIds[stream.id]) {
      throw new Error('received one unique stream per event')
    } else {
      receivedIds[stream.id] = true
    }
    count++
    if (count < 5) {
      peer2.addStream(common.getMediaStream())
    }
  })
})

test('incremental multistream on non-initiator only (track event)', function () {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peersToCleanup.push(peer1, peer2)

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer2.on('connect', function () {
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds: Record<string, boolean> = {}

  let count = 0
  peer1.on('track', function (track) {
    if (receivedIds[track.id]) {
      throw new Error('received one unique track per event')
    } else {
      receivedIds[track.id] = true
    }
    count++
    if (count % 2 === 0 && count < 10) {
      peer2.addStream(common.getMediaStream())
    }
  })
})

test('addStream after removeStream', function () {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    return // Skip on iOS which does not support this reliably
  }

  return new Promise<void>((resolve) => {
    const stream1 = common.getMediaStream()
    const stream2 = common.getMediaStream()

    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer({ streams: [stream1] })

    peersToCleanup.push(peer1, peer2)

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    peer1.once('stream', () => {
      peer2.removeStream(stream1)
      setTimeout(() => {
        peer1.once('stream', () => {
          resolve()
        })
        peer2.addStream(stream2)
      }, 1000)
    })
  })
})

test('removeTrack immediately', function () {
  if (!process.browser) return

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer({ })

    peersToCleanup.push(peer1, peer2)

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    const stream1 = common.getMediaStream()
    const stream2 = common.getMediaStream()

    peer1.addTrack(stream1.getTracks()[0], stream1)
    peer2.addTrack(stream2.getTracks()[0], stream2)

    peer1.removeTrack(stream1.getTracks()[0], stream1)
    peer2.removeTrack(stream2.getTracks()[0], stream2)

    peer1.on('track', function (track, stream) {
      throw new Error('peer1 should not get track event')
    })
    peer2.on('track', function (track, stream) {
      throw new Error('peer2 should not get track event')
    })

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

test('replaceTrack', function () {
  if (!process.browser) return

  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer({ })

    peersToCleanup.push(peer1, peer2)

    peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
    peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

    const stream1 = common.getMediaStream()
    const stream2 = common.getMediaStream()

    peer1.addTrack(stream1.getTracks()[0], stream1)
    peer2.addTrack(stream2.getTracks()[0], stream2)

    peer1.replaceTrack(stream1.getTracks()[0], stream2.getTracks()[0], stream1)
    peer2.replaceTrack(stream2.getTracks()[0], stream1.getTracks()[0], stream2)

    let trackCount = 0
    peer1.on('track', function (track, stream) {
      trackCount++
      peer2.replaceTrack(stream2.getTracks()[0], null, stream2)
      if (trackCount >= 2) checkComplete()
    })
    peer2.on('track', function (track, stream) {
      trackCount++
      peer1.replaceTrack(stream1.getTracks()[0], null, stream1)
      if (trackCount >= 2) checkComplete()
    })

    let connectCount = 0
    function checkComplete() {
      if (connectCount >= 2 && trackCount >= 2) {
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
  })
})
