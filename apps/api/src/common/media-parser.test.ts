import { describe, expect, it } from 'vitest';
import { parseMediaFilename } from './media-parser';

describe('parseMediaFilename', () => {
  it('extracts movie title and year', () => {
    const r = parseMediaFilename('Inception.2010.1080p.BluRay.x264.mkv');
    expect(r.title).toBe('Inception');
    expect(r.year).toBe(2010);
    expect(r.videoQuality).toBe('1080p');
  });

  it('extracts season and episode for TV', () => {
    const r = parseMediaFilename('Breaking.Bad.S03E07.720p.HDTV.x264.mkv');
    expect(r.title).toBe('Breaking Bad');
    expect(r.season).toBe(3);
    expect(r.episode).toBe(7);
    expect(r.videoQuality).toBe('720p');
  });

  it('detects 4K from 2160p / UHD tokens', () => {
    expect(parseMediaFilename('Dune.2021.2160p.WEB-DL.mkv').videoQuality).toBe('4K');
    expect(parseMediaFilename('Dune.2021.UHD.BluRay.mkv').videoQuality).toBe('4K');
  });

  it('detects Dolby Vision and HDR independently', () => {
    const dv = parseMediaFilename('Movie.2024.2160p.DV.HDR10.WEB-DL.x265.mkv');
    expect(dv.dolbyVision).toBe(true);
    expect(dv.hdr).toBe(true);

    const sdr = parseMediaFilename('Movie.2024.1080p.WEB-DL.x264.mkv');
    expect(sdr.dolbyVision).toBe(false);
    expect(sdr.hdr).toBe(false);
  });

  it('detects audio format with priority Atmos > DTS:X > DTS-HD > DTS', () => {
    expect(parseMediaFilename('Movie.TrueHD.Atmos.mkv').audioFormat).toBe('Dolby Atmos');
    expect(parseMediaFilename('Movie.DTS-X.mkv').audioFormat).toBe('DTS:X');
    expect(parseMediaFilename('Movie.DTS-HD.MA.mkv').audioFormat).toBe('DTS-HD MA');
    expect(parseMediaFilename('Movie.DTS.mkv').audioFormat).toBe('DTS');
  });

  it('falls back to raw filename if title cannot be parsed', () => {
    const r = parseMediaFilename('weird_random_name.mkv');
    expect(r.title).toBeTruthy();
    expect(r.hdr).toBe(false);
  });
});
