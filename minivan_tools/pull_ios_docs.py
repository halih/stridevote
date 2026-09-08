#!/usr/bin/env python3
"""
pull_ios_docs.py — fetch every file from a paired iPhone app's Files-app folder
("On My iPhone > <App>") over USB, no full-device backup needed.

Works for any app that exposes its Documents dir to the Files app
(UIFileSharingEnabled / documents-in-place) — MiniVAN does. Uses house_arrest's
Documents channel. Requires the iPhone paired & unlocked, and pymobiledevice3.

Usage:
    python3 pull_ios_docs.py <bundle_id> <dest_dir>
    python3 pull_ios_docs.py com.voteractivationnetwork.minivan ./minivan_ios
"""
import asyncio, os, sys, posixpath
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.house_arrest import HouseArrestService

BUNDLE = sys.argv[1] if len(sys.argv) > 1 else "com.voteractivationnetwork.minivan"
DEST = sys.argv[2] if len(sys.argv) > 2 else "./ios_docs"


async def walk_pull(afc, remote, local):
    os.makedirs(local, exist_ok=True)
    for entry in await afc.listdir(remote):
        if entry in (".", ".."):
            continue
        rpath = posixpath.join(remote, entry)
        st = await afc.stat(rpath)
        lpath = os.path.join(local, entry)
        if st.get("st_ifmt") == "S_IFDIR":
            await walk_pull(afc, rpath, lpath)
        else:
            data = await afc.get_file_contents(rpath)
            with open(lpath, "wb") as f:
                f.write(data)
            print(f"  {rpath}  ({len(data)} bytes)")


async def main():
    os.makedirs(DEST, exist_ok=True)
    lockdown = await create_using_usbmux()
    afc = await HouseArrestService.create(
        lockdown=lockdown, bundle_id=BUNDLE, documents_only=True)
    print(f"pulling Documents of {BUNDLE} -> {DEST}")
    try:
        await walk_pull(afc, "/Documents", DEST)
    finally:
        await afc.close()
    print("done.")


asyncio.run(main())
