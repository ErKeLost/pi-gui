//! System-wide "now playing" signal (macOS MediaRemote).
//!
//! Media apps (Electron players in particular) often render transport state as
//! unlabeled icons, so the AX tree cannot tell whether audio is playing. The OS
//! media session is an app-agnostic, read-only fact the verifier can rely on.
//! Loaded dynamically; any failure degrades to `None` instead of an error.

use serde_json::{json, Value};

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::sync::mpsc;
    use std::time::Duration;

    type CFTypeRef = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
        fn CFStringCreateWithCString(alloc: CFTypeRef, s: *const c_char, enc: u32) -> CFTypeRef;
        fn CFStringGetCString(s: CFTypeRef, buf: *mut c_char, size: isize, enc: u32) -> bool;
        fn CFNumberGetValue(n: CFTypeRef, kind: isize, out: *mut c_void) -> bool;
        fn CFGetTypeID(v: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFRelease(v: CFTypeRef);
    }
    extern "C" {
        fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
        fn dispatch_get_global_queue(identifier: isize, flags: usize) -> *mut c_void;
    }
    const UTF8: u32 = 0x0800_0100;

    unsafe fn string(dict: CFTypeRef, key: &str) -> Option<String> {
        let k = CString::new(key).ok()?;
        let cf_key = CFStringCreateWithCString(std::ptr::null(), k.as_ptr(), UTF8);
        let v = CFDictionaryGetValue(dict, cf_key);
        CFRelease(cf_key);
        if v.is_null() || CFGetTypeID(v) != CFStringGetTypeID() { return None }
        let mut buf = vec![0 as c_char; 1024];
        if !CFStringGetCString(v, buf.as_mut_ptr(), buf.len() as isize, UTF8) { return None }
        Some(CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
    }
    unsafe fn number(dict: CFTypeRef, key: &str) -> Option<f64> {
        let k = CString::new(key).ok()?;
        let cf_key = CFStringCreateWithCString(std::ptr::null(), k.as_ptr(), UTF8);
        let v = CFDictionaryGetValue(dict, cf_key);
        CFRelease(cf_key);
        if v.is_null() || CFGetTypeID(v) != CFNumberGetTypeID() { return None }
        let mut out = 0f64;
        // kCFNumberFloat64Type = 6
        if CFNumberGetValue(v, 6, &mut out as *mut f64 as *mut c_void) { Some(out) } else { None }
    }

    pub struct Info { pub title: Option<String>, pub artist: Option<String>, pub album: Option<String>, pub rate: Option<f64>, pub playing: Option<bool> }

    pub fn query() -> Option<Info> {
        unsafe {
            let path = CString::new("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote").ok()?;
            let handle = dlopen(path.as_ptr(), 1);
            if handle.is_null() { return None }
            let info_sym = dlsym(handle, c"MRMediaRemoteGetNowPlayingInfo".as_ptr());
            let playing_sym = dlsym(handle, c"MRMediaRemoteGetNowPlayingApplicationIsPlaying".as_ptr());
            if info_sym.is_null() { return None }
            type InfoFn = unsafe extern "C" fn(*mut c_void, &block2::Block<dyn Fn(CFTypeRef)>);
            type PlayingFn = unsafe extern "C" fn(*mut c_void, &block2::Block<dyn Fn(u8)>);
            let queue = dispatch_get_global_queue(0, 0);
            let (tx, rx) = mpsc::channel::<Option<(Option<String>, Option<String>, Option<String>, Option<f64>)>>();
            let block = block2::RcBlock::new(move |dict: CFTypeRef| {
                let value = if dict.is_null() { None } else {
                    Some((
                        string(dict, "kMRMediaRemoteNowPlayingInfoTitle"),
                        string(dict, "kMRMediaRemoteNowPlayingInfoArtist"),
                        string(dict, "kMRMediaRemoteNowPlayingInfoAlbum"),
                        number(dict, "kMRMediaRemoteNowPlayingInfoPlaybackRate"),
                    ))
                };
                let _ = tx.send(value);
            });
            std::mem::transmute::<*mut c_void, InfoFn>(info_sym)(queue, &block);
            let fields = rx.recv_timeout(Duration::from_secs(2)).ok()??;
            let mut playing = None;
            if !playing_sym.is_null() {
                let (ptx, prx) = mpsc::channel::<bool>();
                let pblock = block2::RcBlock::new(move |p: u8| { let _ = ptx.send(p != 0); });
                std::mem::transmute::<*mut c_void, PlayingFn>(playing_sym)(queue, &pblock);
                playing = prx.recv_timeout(Duration::from_secs(2)).ok();
            }
            Some(Info { title: fields.0, artist: fields.1, album: fields.2, rate: fields.3, playing })
        }
    }
}

pub fn now_playing() -> Value {
    #[cfg(target_os = "macos")]
    if let Some(info) = mac::query() {
        let playing = info.playing.or(info.rate.map(|r| r > 0.0));
        return json!({ "available": true, "title": info.title, "artist": info.artist, "album": info.album, "playing": playing });
    }
    json!({ "available": false })
}
