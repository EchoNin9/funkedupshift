import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

export async function takePhoto(source: CameraSource = CameraSource.Prompt) {
  const image = await Camera.getPhoto({
    quality: 85,
    allowEditing: false,
    resultType: CameraResultType.Base64,
    source,
    width: 1920,
    height: 1920,
    correctOrientation: true,
  });
  return image;
}

export function base64ToBlob(base64: string, contentType: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: contentType });
}
