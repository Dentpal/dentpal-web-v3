import React, { useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import SellersService from '@/services/sellers';
import { useAuth } from '@/hooks/use-auth';

interface ProfileUploadProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  title?: string; // Add a title prop for modal reuse
  /**
   * When set, the selected image's width/height ratio must match this value
   * (e.g. 8 / 3 for store banners). Leave undefined to allow any ratio.
   */
  aspectRatio?: number;
  /** Human-readable label for the required ratio, shown in hints/errors (e.g. "8:3"). */
  aspectRatioLabel?: string;
}

// How far the uploaded image's ratio may deviate from the required ratio.
// Small tolerance absorbs rounding (e.g. 1920x721) while still rejecting
// clearly different ratios like 16:9, 4:3 or 1:1.
const ASPECT_RATIO_TOLERANCE = 0.03;

// Read an image file's intrinsic pixel dimensions without adding it to the DOM.
const readImageSize = (file: File): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image.'));
    };
    img.src = url;
  });

const ProfileUpload: React.FC<ProfileUploadProps> = ({
  open,
  onClose,
  onUpload,
  title = 'Upload Profile Image',
  aspectRatio,
  aspectRatioLabel,
}) => {
  const { uid } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const ratioLabel = aspectRatioLabel ?? (aspectRatio ? aspectRatio.toFixed(2) : '');

  // Returns true when `file` satisfies the required aspect ratio (or when no
  // ratio is enforced). Sets an error and clears state otherwise.
  const validateAspectRatio = async (file: File): Promise<boolean> => {
    if (!aspectRatio) return true;
    let size: { width: number; height: number };
    try {
      size = await readImageSize(file);
    } catch {
      setError('Could not read that image. Please try a different file.');
      return false;
    }
    const ratio = size.width / size.height;
    if (Math.abs(ratio - aspectRatio) > ASPECT_RATIO_TOLERANCE) {
      setError(
        `This image must have a ${ratioLabel} aspect ratio (e.g. 1920×720). ` +
          `The image you selected is ${size.width}×${size.height}. ` +
          `Please crop or resize it to ${ratioLabel} and try again.`
      );
      return false;
    }
    return true;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;

    if (!(await validateAspectRatio(file))) {
      // Reject the file so it can't be uploaded; reset input so re-picking the
      // same corrected file still fires onChange.
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select an image to upload.');
      return;
    }
    if (!uid) {
      setError('User not authenticated.');
      return;
    }
    try {
      // Safety re-check right before upload in case state was bypassed.
      if (!(await validateAspectRatio(selectedFile))) {
        return;
      }
      // Compress + convert to WebP before upload (smaller payload for the
      // store cover/logo shown in the buyer app).
      const compressedBlob = await imageCompression(selectedFile, {
        maxSizeMB: 0.5, // target max size in MB
        maxWidthOrHeight: 1024, // optional: resize
        fileType: 'image/webp',
        useWebWorker: true,
      });
      const webpName = selectedFile.name.replace(/\.[^.]+$/, '') + '.webp';
      const compressedFile = new File([compressedBlob], webpName, { type: 'image/webp' });
      // Upload to Firebase Storage
      const uploadResult = await SellersService.uploadImage(uid, compressedFile, 'SellerImages');
      // Save to Firestore Seller.vendor.profileImage or coverImage
      const field = title.toLowerCase().includes('cover') ? 'coverImage' : 'profileImage';
      await SellersService.saveVendorProfile(uid, {
        [field]: uploadResult,
      });
      onUpload(compressedFile); // Optionally keep this for parent notification
      setSelectedFile(null);
      onClose();
    } catch (err) {
      setError('Image upload failed. Please try again.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md relative">
        <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600" onClick={onClose}>&times;</button>
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        {aspectRatio && (
          <div className="mb-4 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            Required aspect ratio: <span className="font-semibold text-gray-700">{ratioLabel}</span> (e.g. 1920×720). Other ratios will be rejected.
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="mb-4"
        />
        {selectedFile && (
          <div className="mb-4">
            <img
              src={URL.createObjectURL(selectedFile)}
              alt="Preview"
              className="w-32 h-32 object-cover rounded border mx-auto"
            />
          </div>
        )}
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700"
            onClick={handleUpload}
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileUpload;
