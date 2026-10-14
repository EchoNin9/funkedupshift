# 03b — File saving and opening on native (must fix)

This is part of phase 2. It replaces the earlier "try `navigator.share` first" idea, which doesn't work:
**Android System WebView does not implement the Web Share API** (`navigator.share` is undefined), and
`<a download>` is ignored by Android's WebView. On Android today, every save button below does nothing.

Paths are relative to `src/web/spa/src`.

## Every call site

There are two different problems, so there are two different fixes.

### A. Files generated on the device (blob → user)

| Where | What | Today |
|---|---|---|
| `features/imagetool/ImagePage.tsx:288` `handleDownload` | resized `image.jpg/webp` | `a.download` + `a.click()` |
| `features/croptool/CropPage.tsx:~211` `handleDownload` | `crop.<ext>` | same |
| `features/removebg/RemoveBgPage.tsx:203` `handleDownload` | `background-removed.png` | same |

Each one already has a `Blob` in `result.blob`. Only the "hand it to the user" step needs to change.

### B. Files on the server (presigned S3 URL → user)

| Where | What | Today |
|---|---|---|
| `features/vehicles/VehiclesExpensesPage.tsx:1025` `triggerDownloadFromResponse` | fuel CSV/PDF, maintenance CSV/PDF/ZIP, export-all | `window.open(downloadUrl, "_blank")` |
| `features/lipsync/JobDetail.tsx:233` | finished lipsync MP4 | `<a href download target="_blank">` |
| `features/expenses/GeneralExpensesPage.tsx:457` `openAttachment` | non-previewable receipt attachments (docx, xlsx, csv…) | `window.open` |
| `features/vehicles/VehiclesExpensesPage.tsx:2070` | vehicle attachments | `<a target="_blank">` |
| `GeneralExpensesPage` preview modal (`setPreview({isPdf})`) | **PDF in an iframe** | **Android WebView can't render PDFs inline**, so the modal shows blank. Images are fine. |

Don't fetch these into a blob. The S3 bucket would need CORS for the app's origin, and lipsync videos are large.
Hand the URL to the system instead: Chrome Custom Tabs downloads it, and on iOS SFSafariViewController previews it with a share button.

## Fix: one helper file

Create `utils/saveFile.ts`, about 30 lines, with two exports:

```ts
// Web: unchanged behaviour. Native: write to cache + OS share sheet (Save to Files/Drive/Photos, send, etc).
export async function saveBlob(blob: Blob, filename: string): Promise<void>
// Web: window.open. Native: system browser (Custom Tabs / SFSafariViewController) handles download/preview.
export async function openRemoteFile(url: string): Promise<void>
```

- `saveBlob`, native path:
  1. Convert the blob to base64 with `FileReader.readAsDataURL` and strip the prefix.
  2. Call `Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })`.
  3. Call `Share.share({ files: [uri], title: filename })`.
  4. Treat a user-cancelled share as success, not an error.
- `saveBlob`, web path: the existing 4-line anchor code, moved here so the three pages stop duplicating it.
  Call `URL.revokeObjectURL` only if the helper created the URL; the pages still use `result.url` for preview.
- `openRemoteFile`: on native, call `Browser.open({ url })`. On web, call `window.open(url, "_blank", "noopener,noreferrer")`.

New dependencies, all official Capacitor 8 plugins matching the existing `@capacitor/camera` and `@capacitor/preferences`:
`@capacitor/filesystem`, `@capacitor/share`, `@capacitor/browser`. Then run `npx cap sync`. Item 3 of doc 03 (external links)
uses the same `@capacitor/browser`, so it adds nothing extra.

Native config:
- Android: `@capacitor/share` with files needs the FileProvider that Capacitor's Android template already declares. Check
  `AndroidManifest.xml` for `androidx.core.content.FileProvider`. If `cap sync` doesn't add it, add it with `res/xml/file_paths.xml` covering `cache-path`.
  You don't need storage permissions, because we never write to shared storage.
- iOS: no Info.plist keys for share or files. Saving to Photos from the share sheet needs `NSPhotoLibraryAddUsageDescription`.
  Add it alongside the camera strings in doc 03 item 8.

## Call-site changes

- The three `handleDownload` bodies become `saveBlob(result.blob, "<same filename>")`.
- `triggerDownloadFromResponse`, `openAttachment`'s `window.open` and the vehicle attachment link use `openRemoteFile(url)`.
  The link becomes a `<button>`, or keeps the `<a>` with an `onClick` that calls `preventDefault` on native.
- Lipsync download `<a>` gets the same `onClick` treatment.
- PDF preview on native: skip the iframe modal and call `openRemoteFile(url)`. That's one `isNative ||` added to the `attachmentOpensInModal` check.
  Leave image previews in the modal; they render fine.
- Button labels stay "Download". On native the result is the OS share sheet, which is the standard "save" UX on both platforms.

## Out of scope

- A "Save to gallery" button that skips the share sheet. It needs a community plugin, and the share sheet already offers Save to Photos/Gallery.
- Download progress UI for large server files. The system browser shows its own.

## QA (adds rows to doc 04)

Run on an Android device, and on iOS if it's built:

- [ ] Image Resizer, Crop and Remove BG: tap Download, the share sheet opens with the right filename and type, Save to Files/Drive works, and the file opens.
- [ ] Cancelling the share sheet shows no error toast.
- [ ] Vehicles: fuel CSV + PDF, maintenance CSV/PDF/ZIP and export-all each download via the system browser.
- [ ] Lipsync finished job: Download opens the MP4 in the system browser, and it can be saved.
- [ ] General expenses: a PDF attachment opens in the system browser (not a blank modal), an image attachment still previews in the modal, and a docx/xlsx attachment downloads.
- [ ] Web (desktop + mobile browser): all of the above behave exactly as before. That's the regression check.

## Done means

- `grep -rn "a.download\|window.open" src/features` returns nothing. Every save or open goes through `utils/saveFile.ts`.
- `npm run build` is green. The QA list above passes on Android.
- Report the diff and device results before committing.
