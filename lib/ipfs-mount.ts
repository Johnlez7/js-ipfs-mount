import * as fs from "fs"
import * as Fuse from "fuse-native"
import { IpfsClient } from "ipfs-api"
const debug = require("debug")("IpfsMount")

import { getOrAdd } from "./extensions"
import { filter, gather, map } from "./iterable"
import { IpfsReader, IpfsReader_Direct } from "./ipfs-read"


function errorToCode(err: any): number {
  return typeof err === "number" ? err
       : err instanceof Error && err.message === "file does not exist" ? Fuse.ENOENT
       : err instanceof Error && err.message === "path must contain at least one component" ? Fuse.EPERM
       : -1;
}

export function IpfsMount(
  ipfs: IpfsClient,
  reader: IpfsReader = IpfsReader_Direct(ipfs),
): Fuse.Handlers {

  const firstAccessByPath = new Map<string, Date>()

  return {
    create: (path, mode, reply) => reply(Fuse.EROFS),

    open: (path, flags, reply) => {
      debug("open " + path)
      return reply(0, 22)
    },

    opendir: (path, flags, reply) => {
      debug("opendir " + path)
      if (path === "/") return reply(Fuse.EPERM, -1)
      return reply(0, -1)
    },

    //statfs: (path, reply) => {
    //  debug("statfs " + path)
    //},

    getattr: (path, cb) => {
      const reply = (code: number, stats: Fuse.Stats) => {
        debug({ code, stats })
        cb(code, stats)
      }
      const bail = (err: any, reason?: any) => {
        debug({ err, reason })
        reply(errorToCode(err), undefined!)
      }

      const now = new Date(Date.now())
      const firstAccess = getOrAdd(firstAccessByPath, path, now)

      let stats = {
        dev: 0,
        ino: 0,
        size: 0,
        mode: 0,
        nlink: 0,
        uid: process.getuid ? process.getuid() : 0,
        gid: process.getgid ? process.getgid() : 0,
        rdev: 0,
        blksize: 0,
        blocks: 0,
        ctime: firstAccess,
        mtime: firstAccess,
        atime: now,
      }

      const ipfsPath = path === "/" ? path : "/ipfs/"+path

      ipfs.files.stat(ipfsPath)
        .then(ipfsStat => {
          debug({ ipfsStat })

          const [filetype, permissions] =
            ipfsStat.type === "directory" ? [fs.constants.S_IFDIR, 0o111] :
            ipfsStat.type === "file"      ? [fs.constants.S_IFREG, 0o444] :
                                            [0, 0o000]
          stats = Object.assign(stats, {
            size: ipfsStat.size,
            nlink: 1,
            mode: filetype | permissions
          })
          return reply(0, stats as Fuse.Stats)
        })
        .catch((err: any) => bail(err, "ipfs files stat"))
    },

    readdir: (path, cb) => {
      debug("readdir " + path)

      const reply = (code: number, files: string[]) => {
        debug({ files });
        cb(code, files)
      }
      const bail = (err: any, reason?: any) => {
        debug({ err, reason });
        reply(errorToCode(err), [])
      }

      // todo: extra slashes cause "Error: path must contain at least one component"
      const ipfsPath = path === "/" ? path : "/ipfs"+path

      gather(
        map(
          filter(ipfs.ls(ipfsPath), file => file.depth === 1),
          file => file.name)
        )
        .then(names => reply(0, names))
        .catch((err: any) => bail(err, "ipfs ls"))
    },

    read: (path, fd, buffer, length, offset, cb) => {
      debug("read " + path, { offset, length })

      const reply = (bytesReadOrError: number) => {
        debug({ bytesReadOrError });
        cb(bytesReadOrError)
      }
      const bail = (err: any, reason?: any) => {
        debug({ err, reason });
        reply(errorToCode(err))
      }

      if (path === "/") return bail(Fuse.EPERM)

      const ipfsPath = path.substring(1)

      reader.read(ipfsPath, buffer, { offset, length })
        .then(result => reply(result.length))
        .catch(bail)
    },
  }
}
