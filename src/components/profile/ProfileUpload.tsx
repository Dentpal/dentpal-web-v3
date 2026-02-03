import React, { useRef, useState } from 'react';
import imageCompression from 'browser-image-compression';
import SellersService from '@/services/sellers';
import { useAuth } from '@/hooks/use-auth';

interface ProfileUploadProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  title?: string; // Add a title prop for modal reuse
}

const ProfileUpload: React.FC<ProfileUploadProps> = ({ open, onClose, onUpload, title = 'Upload Profile Image' }) => {
  const { uid } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      setSelectedFile(file);
      setError('');
    }
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
      // Compress the image before upload
      const compressedFile = await imageCompression(selectedFile, {
        maxSizeMB: 0.5, // target max size in MB
        maxWidthOrHeight: 1024, // optional: resize
        useWebWorker: true,
      });
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
