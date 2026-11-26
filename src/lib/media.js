/** Утилиты для загрузки аватарки и музыки профиля DviGram. */

export const AVATAR_MAX_BYTES = 320 * 1024;
export const MUSIC_MAX_BYTES = 2.5 * 1024 * 1024;

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

/** Обрезает изображение до квадрата и уменьшает его до 256×256. */
export async function prepareAvatar(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Выберите изображение PNG, JPEG, WebP или GIF');
  if (file.size > 8 * 1024 * 1024) throw new Error('Исходное изображение слишком большое. Максимум 8 МБ');

  const dataUrl = await readFileAsDataUrl(file);
  if (dataUrl.length <= 420_000 && (file.type === 'image/gif' || file.size <= 200_000)) return dataUrl;

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть изображение'));
    img.src = dataUrl;
  });

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не поддерживает обработку изображений');

  ctx.fillStyle = '#0b7cff';
  ctx.fillRect(0, 0, size, size);
  const side = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const sx = ((image.naturalWidth || image.width) - side) / 2;
  const sy = ((image.naturalHeight || image.height) - side) / 2;
  ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);

  const webp = canvas.toDataURL('image/webp', 0.86);
  const output = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.86);
  if (output.length > 430_000) throw new Error('Аватарка слишком большая. Попробуйте другое изображение');
  return output;
}

export function validateMusicFile(file) {
  const allowedType = /^audio\/(mpeg|mp4|wav|webm|ogg|x-wav|x-m4a|aac)$/.test(file?.type || '');
  const allowedName = /\.(mp3|m4a|wav|ogg|webm|aac)$/i.test(file?.name || '');
  if (!allowedType && !allowedName) throw new Error('Поддерживаются MP3, M4A, WAV, OGG и WebM');
  if (file.size > MUSIC_MAX_BYTES) throw new Error('Музыка слишком большая. Максимум 2.5 МБ');
  return file;
}

export async function prepareMusic(file) {
  validateMusicFile(file);
  return readFileAsDataUrl(file);
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
