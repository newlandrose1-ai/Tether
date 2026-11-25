import { Type, type Schema } from '@google/genai';

export const INTENT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    recommendedProfileId: {
      type: Type.STRING,
      enum: ['browser-game-2d', 'web-page', 'api-service'],
      description: 'Best fitting primary project profile.',
    },
    confidence: {
      type: Type.INTEGER,
      description: 'Confidence percentage from 0 to 100.',
    },
    reasoning: {
      type: Type.STRING,
      description: 'Short explanation citing concrete signals from the evidence summary.',
    },
    suggestedModifiers: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: ['pwa', 'typescript', 'docker'],
      },
      description: 'Applicable optional modifiers.',
    },
    cautionNotes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Any ambiguities or mixed-stack signals the user should confirm.',
    },
  },
  required: [
    'recommendedProfileId',
    'confidence',
    'reasoning',
    'suggestedModifiers',
    'cautionNotes',
  ],
};

export const GAP_ANALYSIS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    suggestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          findingTitle: { type: Type.STRING },
          findingDescription: { type: Type.STRING },
          category: { type: Type.STRING },
          severity: {
            type: Type.STRING,
            enum: ['high', 'medium', 'low'],
          },
          proposalTitle: { type: Type.STRING },
          why: { type: Type.STRING },
          expectedEffect: { type: Type.STRING },
          riskTier: {
            type: Type.STRING,
            enum: ['A', 'C'],
          },
          targetPath: { type: Type.STRING },
          action: {
            type: Type.STRING,
            enum: ['add', 'modify'],
          },
          suggestedContent: { type: Type.STRING },
        },
        required: [
          'findingTitle',
          'findingDescription',
          'category',
          'severity',
          'proposalTitle',
          'why',
          'expectedEffect',
          'riskTier',
          'targetPath',
          'action',
          'suggestedContent',
        ],
      },
    },
  },
  required: ['suggestions'],
};
