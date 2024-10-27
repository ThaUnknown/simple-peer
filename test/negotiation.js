import common from './common.js'
import Peer from '../index.js'
import test from 'tape'

test('single negotiation', function (t) {
  if (!process.browser) return t.end()
  t.plan(10)

  const peer1 = new Peer({ initiator: true, stream: common.getMediaStream() })
  const peer2 = new Peer({ stream: common.getMediaStream() })

  peer1.on('signal', function (data) {
    if (data.renegotiate) t.fail('got unexpected request to renegotiate')
    if (!peer2.destroyed) peer2.signal(data)
  })
  peer2.on('signal', function (data) {
    if (data.renegotiate) t.fail('got unexpected request to renegotiate')
    if (!peer1.destroyed) peer1.signal(data)
  })

  peer1.on('connect', function () {
    t.pass('peer1 connected')
  })
  peer2.on('connect', function () {
    t.pass('peer2 connected')
  })

  peer1.on('stream', function (stream) {
    t.pass('peer1 got stream')
  })
  peer2.on('stream', function (stream) {
    t.pass('peer2 got stream')
  })

  let trackCount1 = 0
  peer1.on('track', function (track) {
    t.pass('peer1 got track')
    trackCount1++
    if (trackCount1 >= 2) {
      t.pass('got correct number of tracks')
    }
  })
  let trackCount2 = 0
  peer2.on('track', function (track) {
    t.pass('peer2 got track')
    trackCount2++
    if (trackCount2 >= 2) {
      t.pass('got correct number of tracks')
    }
  })
})

test('manual renegotiation', function (t) {
  if (!process.browser) return t.end()
  t.plan(2)

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer()

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    peer1.negotiate()

    peer1.on('negotiated', function () {
      t.pass('peer1 negotiated')
    })
    peer2.on('negotiated', function () {
      t.pass('peer2 negotiated')
    })
  })
})

test('repeated manual renegotiation', function (t) {
  if (!process.browser) return t.end()
  t.plan(6)

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer()

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.once('connect', function () {
    peer1.negotiate()
  })
  peer1.once('negotiated', function () {
    t.pass('peer1 negotiated')
    peer1.negotiate()
    peer1.once('negotiated', function () {
      t.pass('peer1 negotiated again')
      peer1.negotiate()
      peer1.once('negotiated', function () {
        t.pass('peer1 negotiated again')
      })
    })
  })
  peer2.once('negotiated', function () {
    t.pass('peer2 negotiated')
    peer2.negotiate()
    peer2.once('negotiated', function () {
      t.pass('peer2 negotiated again')
      peer1.negotiate()
      peer1.once('negotiated', function () {
        t.pass('peer1 negotiated again')
      })
    })
  })
})

test('renegotiation after addStream', function (t) {
  if (!process.browser) return t.end()
  if (common.isBrowser('ios')) {
    t.pass('Skip on iOS which does not support this reliably')
    t.end()
    return
  }
  t.plan(4)

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer()

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    t.pass('peer1 connect')
    peer1.addStream(common.getMediaStream())
  })
  peer2.on('connect', function () {
    t.pass('peer2 connect')
    peer2.addStream(common.getMediaStream())
  })
  peer1.on('stream', function () {
    t.pass('peer1 got stream')
  })
  peer2.on('stream', function () {
    t.pass('peer2 got stream')
  })
})

test('add stream on non-initiator only', function (t) {
  if (!process.browser) return t.end()
  t.plan(3)

  const peer1 = new Peer({
    initiator: true
  })
  const peer2 = new Peer({
    stream: common.getMediaStream()
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    t.pass('peer1 connect')
  })
  peer2.on('connect', function () {
    t.pass('peer2 connect')
  })
  peer1.on('stream', function () {
    t.pass('peer1 got stream')
  })
})

test('negotiated channels', function (t) {
  t.plan(2)

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

  peer1.on('connect', function () {
    t.pass('peer1 connect')
  })
  peer2.on('connect', function () {
    t.pass('peer2 connect')
  })
})

test('ice restart causes renegotiation', function (t) {
  if (!process.browser) return t.end()
  t.plan(8)
  t.timeoutAfter(20000)

  const peer1 = new Peer({ initiator: true, iceRestartEnabled: "onDisconnect" })
  const peer2 = new Peer({ iceRestartEnabled: "onDisconnect" })

  // peer1._debug = (...args) => { console.log('peer1 ' + args.shift(), ...args) }
  // peer2._debug = (...args) => { console.log('peer2 ' + args.shift(), ...args) }

  peer1.on('signal', function (data) {
    if (!peer2.destroyed) peer2.signal(data)
  })
  peer2.on('signal', function (data) {
    if (!peer1.destroyed) peer1.signal(data)
  })

  peer1.once('connect', tryTest)
  peer2.once('connect', tryTest)

  function tryTest () {
    if (!peer1.connected || !peer2.connected) return

    peer1.restartIce();
    setTimeout(() => {
      t.equal(peer1.restartIce(), false, 'peer1 calling restartIce() again in quick succession should return false because we are already restarting ice')
    }, 0) // test that calling restartIce multiple times doesn't break anything
    t.equal(peer2.restartIce(), false, 'peer2 restartIce should return false because peer2 is not the initiator')

    peer1.once('reconnect', function () {
      t.pass('peer1 reconnect after ice restart')
    })

    peer2.once('reconnect', function () {
      t.pass('peer2 reconnect after ice restart')
    })

    peer1.once('connect', function () {
      t.fail('peer1 connect event after ice restart, should be reconnect')
    })

    peer2.once('connect', function () {
      t.fail('peer2 connect event after ice restart, should be reconnect')
    })

    function onPeer1SignalState (state) {
      if (state === 'stable') {
        t.pass('peer1 stable after ice restart')
        peer1.removeListener('signalingStateChange', onPeer1SignalState)
      } else {
        console.log('peer1 signalingStatechange = ' + state)
      }
    }

    function onPeer2SignalState(state) {
      if (state === 'stable') {
        t.pass('peer2 stable after ice restart')
        peer2.removeListener('signalingStateChange', onPeer2SignalState)
      } else {
        console.log('peer2 signalingStatechange = ' + state)
      }
    }

    peer1.on('signalingStateChange', onPeer1SignalState)
    peer2.on('signalingStateChange', onPeer2SignalState)

    function onPeer1IceStateChange(state, gatheringState) {
      if (state === 'connected' && gatheringState === 'complete') {
        t.pass('peer1 got ice connected state after ice restart')
        peer1.removeListener('iceStateChange', onPeer1IceStateChange)
      } else {
        console.log('peer1 iceStatechange: ice = ' + state + ', gathering = ' + gatheringState)
      }
    }

    function onPeer2IceStateChange(state, gatheringState) {
      if (state === 'connected' && gatheringState === 'complete') {
        t.pass('peer2 got ice connected state after ice restart')
        peer2.removeListener('iceStateChange', onPeer2IceStateChange)
      } else {
        console.log('peer2 iceStatechange: ice = ' + state + ', gathering = ' + gatheringState)
      }
    }

    peer1.on('iceStateChange', onPeer1IceStateChange)
    peer2.on('iceStateChange', onPeer2IceStateChange)

    peer1.on('_iceGatheringComplete', function () {
      console.log('peer1 _iceGatheringComplete')
    })

    peer2.on('_iceGatheringComplete', function () {
      console.log('peer2 _iceGatheringComplete')
    })

  }
})
