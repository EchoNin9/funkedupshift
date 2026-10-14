import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Web: anchor download. Native: write to cache, then the OS share sheet (Save to Files/Drive/Photos, send, etc). */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const { uri } = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ files: [uri], title: filename });
  } catch (e) {
    // Dismissing the share sheet is not an error.
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}

/** Web: new tab. Native: system browser (Custom Tabs / SFSafariViewController) handles download/preview. */
export async function openRemoteFile(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
