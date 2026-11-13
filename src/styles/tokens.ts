/**
 * Tether Design Token Layer
 *
 * Standardized tokens for color, spacing, typography, radius, elevation, and focus states.
 * Neutral dark obsidian-graphite palette with glassmorphism overlays, defined borders, and strong orange accents.
 */

export const tokens = {
  color: {
    surface: {
      canvas: '#090B0E',
      sidebar: '#0E1015',
      editor: '#0B0D11',
      card: '#13161C',
      cardHover: '#181C24',
      overlay: 'rgba(20, 23, 30, 0.88)',
      accentMuted: 'rgba(249, 115, 22, 0.14)',
    },
    border: {
      subtle: 'rgba(63, 63, 70, 0.48)',
      default: 'rgba(82, 82, 91, 0.62)',
      strong: 'rgba(113, 113, 122, 0.78)',
      accent: '#F97316',
    },
    text: {
      primary: '#F4F4F5',
      secondary: '#D4D4D8',
      muted: '#A1A1AA',
      faint: '#71717A',
    },
    accent: {
      primary: '#F97316',
      primaryHover: '#FB923C',
      secondary: '#A1A1AA',
      warning: '#F59E0B',
      success: '#34D399',
      danger: '#F87171',
    },
  },

  space: {
    '2xs': '0.25rem',
    xs: '0.5rem',
    sm: '0.75rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  },

  typography: {
    family: {
      sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    size: {
      '2xs': '10px',
      xs: '11px',
      sm: '12px',
      base: '13px',
      md: '14px',
      lg: '16px',
    },
    weight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },

  radius: {
    none: '0px',
    xs: '2px',
    sm: '4px',
    md: '6px',
    lg: '8px',
    full: '9999px',
  },

  elevation: {
    flat: 'none',
    subtle: '0 2px 6px rgba(0, 0, 0, 0.45)',
    medium: '0 8px 24px rgba(0, 0, 0, 0.58)',
    popover: '0 16px 40px rgba(0, 0, 0, 0.72)',
  },

  focus: {
    ring: 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500',
    ringAccent: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
  },
} as const;

export type DesignTokens = typeof tokens;
