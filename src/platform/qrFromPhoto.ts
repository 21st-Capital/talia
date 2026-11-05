/**
 * A QR code read from a picture in the photo library (decided 2026-09-08: "add in
 * every single QR scanner of the app the possibility to upload a picture from
 * the photo library that contains the QR").
 *
 * Two native pieces, both behind this one function: the system photo picker
 * (PHPicker on iOS, which needs no permission of its own) and a still-image
 * code detector (CIDetector on iOS, ZXing on Android). Screens never see
 * either; they get the same string a live scan would have produced.
 */
import { launchImageLibrary } from 'react-native-image-picker';
import RNQRGenerator from 'rn-qr-generator';

/** Thrown when the picture holds no readable code. */
export class NoQrInPictureError extends Error {
  constructor() {
    super('No QR code found in that picture.');
    this.name = 'NoQrInPictureError';
  }
}

/**
 * Let the user pick one picture and return the first QR code in it.
 * Resolves null when they cancel the picker; throws NoQrInPictureError when
 * the picture holds no code the detector can read.
 */
export async function pickQrFromPhotos(): Promise<string | null> {
  const res = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    includeBase64: false,
    // A screenshot of a QR is small; a camera photo of a screen is not. The
    // detector copes with either, so no resizing here.
  });
  if (res.didCancel) return null;
  if (res.errorCode) {
    throw new Error(res.errorMessage || 'Could not open the photo library.');
  }
  const uri = res.assets?.[0]?.uri;
  if (!uri) return null;
  const detected = await RNQRGenerator.detect({ uri });
  const value = (detected.values ?? []).map((v) => v.trim()).find((v) => v.length > 0);
  if (!value) throw new NoQrInPictureError();
  return value;
}
