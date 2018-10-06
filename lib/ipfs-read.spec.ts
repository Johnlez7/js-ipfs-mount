import * as fs from "fs"
import * as IpfsApi from "ipfs-api"
import { expect } from "chai"
import { describe, it } from "mocha"
import { promisify } from "util"
import { IpfsReader, IpfsReader_Direct, IpfsReader_ReadStream } from "./ipfs-read"
const readFileAsync = promisify(fs.readFile)


/// returns the result of a successful promise, or undefined if an error occurs
/// workaround for PromiseRejectionHandledWarning: Promise rejection was handled asynchronously
function detach<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.catch(err => {
    console.log({ detached: err })
    return undefined
  })
}

type TestCase = {
  readonly name: string,
  readonly path: string,
  readonly offset?: number,
  readonly expectedBuffer: Readonly<Buffer> | Promise<Readonly<Buffer> | undefined>,
}

function withOffset(source: TestCase, offset: number): TestCase {
  return {
    name: `${source.name} + ${offset}`,
    path: source.path,
    offset: (source.offset || 0) + offset,
    expectedBuffer: Promise.resolve(source.expectedBuffer).then(buffer => buffer && buffer.slice(offset))
  }
}

const rawTestCases: TestCase[] = [
  {
    name: "empty",
    path: "/ipfs/QmbFMke1KXqnYyBBWxB74N4c5SBnJMVAiMNRcGu6x1AwQH",
    expectedBuffer: new Buffer(0),
  },
  {
    name: "hello",
    path: "/ipfs/QmZULkCELmmk5XNfCgTnCyFgAVxBRBXyDHGGMVoLFLiXEN",
    expectedBuffer: new Buffer("hello\n"),
  },
  {
    name: "vlc-2.2.8.tar.xz",
    path: "/ipfs/QmW6vbhabbRUHxfR98cnnDp1m5DjPCsvzZiowh4FbRZPAv",
    expectedBuffer: detach(readFileAsync("/usr/portage/distfiles/vlc-2.2.8.tar.xz")),
  },
  {
    name: "warzone2100-3.2.3.tar.xz",
    path: "/ipfs/Qma9qqDVkh3MtDju7kGXCisposEfzqohvi53NkrKqSmjb2",
    expectedBuffer: detach(readFileAsync("/usr/portage/distfiles/warzone2100-3.2.3.tar.xz")),
  },
]

const testCases = rawTestCases
  .concat(rawTestCases.map(tc => withOffset(tc, 1)))
  .concat(rawTestCases.map(tc => withOffset(tc, 4096)))
  .sort((a, b) => a.name.localeCompare(b.name))


const ipfs = new IpfsApi()
const readers = [
  { name: "IpfsReader_Direct", reader: IpfsReader_Direct(ipfs) },
  { name: "IpfsReader_ReadStream", reader: IpfsReader_ReadStream(ipfs) },
]

for (const { name, reader } of readers) {
  describe(name, () => {
    for (const testCase of testCases) {
      it(testCase.name, async function (this) {
        const expectedBuffer = await testCase.expectedBuffer
        if (!expectedBuffer) {
          this.skip()
          return
        }

        // use longer buffer to test for overflow
        const buffer = new Buffer(expectedBuffer.byteLength + 4)
        const segment = { offset: testCase.offset || 0, length: buffer.byteLength }
        const result = await reader.read(testCase.path, buffer, segment)

        expect(result.offset).to.deep.equal(segment.offset)

        const actual = buffer.slice(0, result.length)
        expect(actual).to.deep.equal(expectedBuffer)

        const leftover = buffer.slice(result.length)
        expect(leftover).to.deep.equal(new Buffer(leftover.byteLength), "overflow into empty bytes!")
      }).timeout(5000)
    }
  })
}
