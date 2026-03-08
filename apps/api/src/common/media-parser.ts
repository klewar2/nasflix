import * as ptt from 'parse-torrent-title';

export interface ParsedMediaInfo {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  videoQuality?: string;
  hdr: boolean;
  dolbyVision: boolean;
  dolbyAtmos: boolean;
  audioFormat?: string;
}

export function parseMediaFilename(filename: string): ParsedMediaInfo {
  const parsed = ptt.parse(filename);

  // Video quality
  let videoQuality: string | undefined;
  const res = parsed.resolution?.toLowerCase();
  if (res) {
    if (['2160p', '4k', 'uhd'].includes(res)) videoQuality = '4K';
    else if (res === '1080p') videoQuality = '1080p';
    else if (res === '720p') videoQuality = '720p';
    else if (res === '480p') videoQuality = '480p';
    else videoQuality = parsed.resolution;
  }

  // Dolby Vision (check before HDR since DV files often also flag HDR)
  const dolbyVision = /\b(DV|Dolby\.?Vision|DoVi|DOVI)\b/i.test(filename);

  // HDR (HDR10, HDR10+, HDR)
  const hdr = /\bHDR(10\+?)?\b/i.test(filename);

  // Dolby Atmos
  const dolbyAtmos = /\bAtmos\b/i.test(filename);

  // Audio format (by priority)
  let audioFormat: string | undefined;
  if (dolbyAtmos) {
    audioFormat = 'Dolby Atmos';
  } else if (/\bDTS[-.]?X\b/i.test(filename)) {
    audioFormat = 'DTS:X';
  } else if (/\bDTS[-.]?HD\b/i.test(filename)) {
    audioFormat = 'DTS-HD MA';
  } else if (/\bDTS\b/i.test(filename)) {
    audioFormat = 'DTS';
  } else if (/\bTrueHD\b/i.test(filename)) {
    audioFormat = 'Dolby TrueHD';
  } else if (/\b(EAC3|E[-.]AC[-.]?3|DD\+)\b/i.test(filename)) {
    audioFormat = 'Dolby Digital+';
  } else if (/\b(AC3|DD5\.1|DD)\b/i.test(filename)) {
    audioFormat = 'Dolby Digital';
  } else if (/\bAAC\b/i.test(filename)) {
    audioFormat = 'AAC';
  } else if (parsed.audio) {
    audioFormat = parsed.audio;
  }

  return {
    title: parsed.title || filename,
    year: parsed.year,
    season: parsed.season,
    episode: parsed.episode,
    videoQuality,
    hdr,
    dolbyVision,
    dolbyAtmos,
    audioFormat,
  };
}
