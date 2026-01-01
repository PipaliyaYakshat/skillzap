import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';

// Resolve the base folder where nginx is configured to serve files from.
// Set UPLOAD_BASE_PATH in the environment to override this default.
export const getUploadBasePath = (): string => {
  return process.env.UPLOAD_BASE_PATH || '/var/www/html/skillzap/uploads';
};

export const createUploadPath = (subPath: string): string => {
  const basePath = getUploadBasePath();
  const fullPath = `${basePath}/${subPath}`;

  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }

  return fullPath;
};

export const multerProfileImageOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = createUploadPath('profile-images');
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  }),
};

export const multerFileOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = createUploadPath('files');
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  }),
};

export const multerOrganizationLogoOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = createUploadPath('organization-logos');
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  }),
};

/**
 * Converts a filesystem path to a public URL path for nginx
 * @param filePath - The filesystem path (e.g., /var/www/html/skillzap/uploads/profile-images/filename.png)
 * @param subPath - The subdirectory type (profile-images, files, organization-logos)
 * @param filename - The filename
 * @returns Public URL path (e.g., /skillzap/uploads/profile-images/filename.png)
 */
export const getPublicUrlPath = (
  subPath: 'profile-images' | 'files' | 'organization-logos' | 'avatars',
  filename: string,
): string => {
  return `/skillzap/uploads/${subPath}/${filename}`;
};

/**
 * Converts a filesystem path to a public URL path
 * @param filePath - The filesystem path
 * @returns Public URL path or original path if conversion fails
 */
export const convertToPublicUrl = (filePath: string | null | undefined): string | null => {
  if (!filePath) return null;
  
  // If already a public URL (starts with /skillzap/uploads), return as is
  if (filePath.startsWith('/skillzap/uploads/')) {
    return filePath;
  }
  
  // Extract filename from filesystem path
  const filename = filePath.split('/').pop() || '';
  
  // Determine subPath based on filename or path
  if (filePath.includes('profile-images') || filename.startsWith('profileImage-')) {
    return getPublicUrlPath('profile-images', filename);
  } else if (filePath.includes('organization-logos') || filename.startsWith('organizationLogo-')) {
    return getPublicUrlPath('organization-logos', filename);
  } else if (filePath.includes('files/') || filename.startsWith('file-')) {
    return getPublicUrlPath('files', filename);
  } else if (filePath.includes('avatars') || filename.startsWith('avatar-')) {
    return getPublicUrlPath('avatars', filename);
  }
  
  // Fallback: try to extract from path structure
  const basePath = getUploadBasePath();
  if (filePath.startsWith(basePath)) {
    const relativePath = filePath.replace(basePath, '').replace(/^\//, '');
    const parts = relativePath.split('/');
    if (parts.length >= 2) {
      const subPath = parts[0] as 'profile-images' | 'files' | 'organization-logos' | 'avatars';
      const file = parts[parts.length - 1];
      return getPublicUrlPath(subPath, file);
    }
  }
  
  // If we can't determine, return original (might be a URL already)
  return filePath;
};

