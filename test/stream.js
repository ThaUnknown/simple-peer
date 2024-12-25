import Peer from '../index.js'
import str from 'string-to-stream'
import test from 'tape'

// test('duplex stream: send data before "connect" event', function (t) {
//   t.plan(9)
//   t.timeoutAfter(20000)

//   const peer1 = new Peer({ initiator: true })
//   const peer2 = new Peer()
//   peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
//   peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

//   str('abc').pipe(peer1)

//   peer1.on('data', function () {
//     t.fail('peer1 should not get data')
//   })
//   peer1.on('finish', function () {
//     t.pass('got peer1 "finish"')
//     t.ok(peer1._writableState.ended)
//   })
//   peer1.on('end', function () {
//     t.pass('got peer1 "end"')
//     t.ok(peer1._readableState.ended)
//   })

//   peer2.on('data', function (chunk) {
//     t.equal(Buffer.from(chunk).toString(), 'abc', 'got correct message')
//   })
//   peer2.on('finish', function () {
//     t.pass('got peer2 "finish"')
//     t.ok(peer2._writableState.ended)
//   })
//   peer2.on('end', function () {
//     t.pass('got peer2 "end"')
//     t.ok(peer2._readableState.ended)
//   })
// })

test('duplex stream: send data one-way', function (t) {
  t.plan(9)
  t.timeoutAfter(20000)

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer()
  peer1.on('signal', function (data) { peer2.signal(data) })
  peer2.on('signal', function (data) { peer1.signal(data) })
  peer1.on('connect', tryTest)
  peer2.on('connect', tryTest)

  function tryTest () {
    if (!peer1.connected || !peer2.connected) return

    peer1.on('data', function () {
      t.fail('peer1 should not get data')
    })
    peer1.on('finish', function () {
      t.pass('got peer1 "finish"')
      t.ok(peer1._writableState.ended)
    })
    peer1.on('end', function () {
      t.pass('got peer1 "end"')
      t.ok(peer1._readableState.ended)
    })

    peer2.on('data', function (chunk) {
      t.equal(Buffer.from(chunk).toString(), 'abc', 'got correct message')
    })
    peer2.on('finish', function () {
      t.pass('got peer2 "finish"')
      t.ok(peer2._writableState.ended)
    })
    peer2.on('end', function () {
      t.pass('got peer2 "end"')
      t.ok(peer2._readableState.ended)
    })

    str('abc').pipe(peer1)
  }
})
