import { describe, expect, it } from 'vitest';
import {
  GLYPH_MIN_EXAMPLES,
  GLYPH_TEMPLATES_PER_DIGIT,
  classifyGlyphs,
  emptyGlyphTemplateSet,
  glyphFeatures,
  glyphLearningLabel,
  glyphTemplateCounts,
  learnGlyphs,
  parseGlyphTemplates,
  serializeGlyphTemplates,
} from '../lib/glyphTemplates';
import { unanimousNumberRead } from '../lib/ocrEngines';
import { numberCrop, timelineNumberCrops } from '../scripts/ocrEngineFixtures.mts';

describe('three-voter ensemble rule', () => {
  it('keeps a number two voters read when the third abstains', () => {
    expect(unanimousNumberRead([{ text: '', confidence: null }, { text: '6', confidence: 97 }, { text: '6', confidence: 93 }])).toEqual({ text: '6', confidence: 93, agreed: true });
  });
  it('drops any number someone read differently', () => {
    expect(unanimousNumberRead([{ text: '6', confidence: 99 }, { text: '6', confidence: 99 }, { text: '8', confidence: 81 }])).toMatchObject({ text: '', agreed: false });
    expect(unanimousNumberRead([{ text: 'b', confidence: 40 }, { text: '6', confidence: 99 }, { text: '6', confidence: 99 }])).toMatchObject({ text: '', agreed: false });
  });
  it('needs two votes: one engine alone never decides', () => {
    expect(unanimousNumberRead([{ text: '', confidence: null }, { text: '6', confidence: 99 }, { text: '', confidence: null }])).toMatchObject({ text: '', agreed: false });
  });
});

describe('what teaches the templates', () => {
  it('learns only from a very sure PaddleOCR read that Tesseract does not contradict', () => {
    expect(glyphLearningLabel({ text: '', confidence: null }, { text: '14', confidence: 99 })).toBe('14');
    expect(glyphLearningLabel({ text: '14', confidence: 60 }, { text: '14', confidence: 99 })).toBe('14');
    expect(glyphLearningLabel({ text: '4', confidence: 90 }, { text: '14', confidence: 99 })).toBeNull();
    expect(glyphLearningLabel({ text: '', confidence: null }, { text: '14', confidence: 90 })).toBeNull();
    expect(glyphLearningLabel({ text: '', confidence: null }, { text: '1234', confidence: 99 })).toBeNull();
  });
});

describe('learned digit templates', () => {
  it('reads held-out HUD numbers with no wrong read (leave one fixture out, per resolution)', async () => {
    for (const height of [1080, 900, 720]) {
      const crops = await timelineNumberCrops(height);
      const fixtures = [...new Set(crops.map(crop => crop.fixture))];
      let correct = 0; let wrong = 0;
      for (const heldOut of fixtures) {
        const set = emptyGlyphTemplateSet();
        for (const crop of crops.filter(item => item.fixture !== heldOut)) learnGlyphs(set, `${height}p`, glyphFeatures(numberCrop(crop)), crop.label);
        for (const crop of crops.filter(item => item.fixture === heldOut)) {
          const read = classifyGlyphs(set, `${height}p`, glyphFeatures(numberCrop(crop)));
          if (read.text === crop.label) correct += 1; else if (read.text) wrong += 1;
        }
      }
      expect({ height, wrong }).toEqual({ height, wrong: 0 });
      expect(correct, `${height}p`).toBeGreaterThanOrEqual(80);
    }
  }, 60_000);

  it('abstains at a resolution it has not learned and for digits with too few examples', async () => {
    const crops = await timelineNumberCrops(1080);
    const set = emptyGlyphTemplateSet();
    for (const crop of crops) learnGlyphs(set, '1080p', glyphFeatures(numberCrop(crop)), crop.label);
    expect(classifyGlyphs(set, '900p', glyphFeatures(numberCrop(crops[0]))).text).toBe('');
    const sparse = emptyGlyphTemplateSet();
    const seven = crops.find(crop => crop.label === '7')!;
    for (let index = 0; index < GLYPH_MIN_EXAMPLES - 1; index += 1) learnGlyphs(sparse, '1080p', glyphFeatures(numberCrop(seven)), '7');
    expect(classifyGlyphs(sparse, '1080p', glyphFeatures(numberCrop(seven))).text).toBe('');
    learnGlyphs(sparse, '1080p', glyphFeatures(numberCrop(seven)), '7');
    expect(classifyGlyphs(sparse, '1080p', glyphFeatures(numberCrop(seven))).text).toBe('7');
  });

  it('refuses a label that does not match the glyph count, and caps examples per digit', async () => {
    const crops = await timelineNumberCrops(1080);
    const set = emptyGlyphTemplateSet();
    const twelve = crops.find(crop => crop.label === '12')!;
    expect(learnGlyphs(set, '1080p', glyphFeatures(numberCrop(twelve)), '1')).toBe(false);
    for (let index = 0; index < GLYPH_TEMPLATES_PER_DIGIT + 5; index += 1) learnGlyphs(set, '1080p', glyphFeatures(numberCrop(twelve)), '12');
    expect(set.byResolution['1080p'].filter(template => template.digit === '1')).toHaveLength(GLYPH_TEMPLATES_PER_DIGIT);
    expect(glyphTemplateCounts(set)).toEqual({ '1080p': 2 });
  });

  it('survives storage: same reads after a round trip, garbage reads as empty', async () => {
    const crops = await timelineNumberCrops(1080);
    const set = emptyGlyphTemplateSet();
    for (const crop of crops.slice(0, 60)) learnGlyphs(set, '1080p', glyphFeatures(numberCrop(crop)), crop.label);
    const restored = parseGlyphTemplates(serializeGlyphTemplates(set));
    for (const crop of crops.slice(60)) expect(classifyGlyphs(restored, '1080p', glyphFeatures(numberCrop(crop))).text).toBe(classifyGlyphs(set, '1080p', glyphFeatures(numberCrop(crop))).text);
    for (const garbage of [null, '', '{', '{"version":"x"}', '{"version":"glyph-templates-v1","byResolution":{"../x":[["1",1,"AA=="]]}}']) expect(parseGlyphTemplates(garbage).byResolution).toEqual({});
  });
});
