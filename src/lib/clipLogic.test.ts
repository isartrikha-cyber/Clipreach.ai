import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCompositeViralScore,
  validateTrimBounds,
  clampClipsToDuration,
  formatTimestamp,
  formatDurationLabel,
  calculateRemainingMinutes,
  parseYouTubeVideoId,
  buildAssSubtitles,
  buildFfmpegFilterGraph,
  type Clip,
} from './clipLogic';

test('calculateCompositeViralScore computes weighted average and clamps 0..100', () => {
  const high = calculateCompositeViralScore({
    hookStrength: 95,
    engagementPotential: 90,
    emotionalImpact: 85,
    pacing: 88,
    contentQuality: 92,
  });
  assert.equal(high, 91);

  const clamped = calculateCompositeViralScore({
    hookStrength: 140,
    engagementPotential: 120,
    emotionalImpact: 110,
    pacing: 100,
    contentQuality: 100,
  });
  assert.equal(clamped, 100);

  const low = calculateCompositeViralScore({
    hookStrength: -10,
    engagementPotential: 0,
    emotionalImpact: 0,
    pacing: 0,
    contentQuality: 0,
  });
  assert.equal(low, 0);
});

test('validateTrimBounds enforces min/max duration and video bounds', () => {
  const valid = validateTrimBounds(10, 40, 120);
  assert.deepEqual(valid, { trimStart: 10, trimEnd: 40, duration: 30 });

  const tooShort = validateTrimBounds(118, 119, 120, 3);
  assert.equal(tooShort.trimEnd, 120);
  assert.equal(tooShort.trimStart, 117);
  assert.equal(tooShort.duration, 3);

  const tooLong = validateTrimBounds(5, 115, 120, 3, 90);
  assert.equal(tooLong.duration, 90);
  assert.equal(tooLong.trimEnd, 95);
});

test('clampClipsToDuration keeps clips and caption words inside video duration', () => {
  const raw: Clip[] = [
    {
      id: 'c1',
      index: 1,
      title: 'Clip One',
      hook: 'Wait until you hear this',
      reasoning: 'Strong opener',
      language: 'en',
      startTime: 25,
      endTime: 65,
      trimStart: 25,
      trimEnd: 65,
      viralScore: {
        overall: 90,
        hookStrength: 92,
        engagementPotential: 90,
        emotionalImpact: 88,
        pacing: 89,
        contentQuality: 90,
      },
      captionStyle: 'hormozi',
      captions: [
        {
          id: 'seg1',
          start: 25,
          end: 70,
          text: 'Hello world',
          words: [
            { id: 'w1', word: 'Hello', start: 25, end: 27, important: true },
            { id: 'w2', word: 'world', start: 58, end: 69, important: false },
          ],
        },
      ],
      framingMode: 'auto-face',
      faceCenterX: 1.4,
      autoZoom: true,
      backgroundVideoId: 'none',
      transitionEffect: 'none',
      exportFormat: 'reels',
    },
  ];

  const clamped = clampClipsToDuration(raw, 45);
  assert.equal(clamped[0].endTime, 45);
  assert.equal(clamped[0].faceCenterX, 0.9);
  assert.ok(clamped[0].captions[0].end <= 45);
  assert.ok(clamped[0].captions[0].words[1].end <= 45);
});

test('formatTimestamp and formatDurationLabel format cleanly', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(75), '01:15');
  assert.equal(formatDurationLabel(45), '45s');
  assert.equal(formatDurationLabel(90), '1m 30s');
});

test('calculateRemainingMinutes computes quota accurately', () => {
  const full = calculateRemainingMinutes(0, 3600);
  assert.equal(full.remainingMinutes, 60);
  assert.equal(full.usedPercent, 0);

  const partial = calculateRemainingMinutes(900, 3600);
  assert.equal(partial.remainingMinutes, 45);
  assert.equal(partial.usedPercent, 25);

  const exhausted = calculateRemainingMinutes(4000, 3600);
  assert.equal(exhausted.remainingMinutes, 0);
  assert.equal(exhausted.usedPercent, 100);
});

test('parseYouTubeVideoId extracts ID from watch, shorts, and youtu.be URLs', () => {
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=12'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeVideoId('https://youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(parseYouTubeVideoId('https://vimeo.com/123456'), null);
});

test('buildAssSubtitles generates valid ASS dialogue events with word highlights', () => {
  const ass = buildAssSubtitles(
    [
      {
        id: 's1',
        start: 10,
        end: 13,
        text: 'Growth starts today',
        words: [
          { id: 'w1', word: 'Growth', start: 10, end: 11, important: true },
          { id: 'w2', word: 'starts', start: 11, end: 12, important: false },
          { id: 'w3', word: 'today', start: 12, end: 13, important: false },
        ],
      },
    ],
    'hormozi',
    10,
    13,
    'auto-face'
  );
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00/);
  assert.match(ass, /GROWTH/);
});

test('buildFfmpegFilterGraph generates valid filter chains for all framing modes', () => {
  const autoFace = buildFfmpegFilterGraph({
    sourceWidth: 1920,
    sourceHeight: 1080,
    framingMode: 'auto-face',
    faceCenterX: 0.5,
    autoZoom: true,
    transitionEffect: 'fade',
    clipDuration: 30,
    hasBackgroundVideo: false,
    assSubtitlePath: 'data/subs/c1.ass',
  });
  assert.match(autoFace.filterComplex, /crop=1080:1920/);
  assert.match(autoFace.filterComplex, /fade=t=in/);
  assert.match(autoFace.filterComplex, /ass=/);
  assert.equal(autoFace.videoOutputLabel, '[vout]');

  const split = buildFfmpegFilterGraph({
    sourceWidth: 1920,
    sourceHeight: 1080,
    framingMode: 'split-gameplay',
    faceCenterX: 0.5,
    autoZoom: false,
    transitionEffect: 'none',
    clipDuration: 30,
    hasBackgroundVideo: true,
  });
  assert.match(split.filterComplex, /vstack=inputs=2/);
  assert.match(split.filterComplex, /\[1:v\]/);
});
