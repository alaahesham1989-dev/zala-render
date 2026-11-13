// Post text for every platform (YouTube, Facebook, Instagram). Owner's order (2026-11-11): the words under a video
// are short and talk about the episode's subject, never about the video itself (no credits, links or notes on how it was made).
// Licences still need their credits, so they go in the first comment instead (creditText), and YouTube's own
// "altered or synthetic content" setting carries the AI note.

const sentences = (t) => String(t || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) || [String(t || '').trim()];

/** The opening paragraph of the description: the story, before any link, chapter or credit. */
export function storyOf(pkg) {
  const d = String(pkg.summary || pkg.description || '');
  const cut = d.search(/\n\n(Plan your Egypt|Chapters:|Sources:|Music:|Narration voice|Image and video credits:)/);
  return (cut >= 0 ? d.slice(0, cut) : d).split('\n\n')[0].trim();
}

export function hashtags(pkg) {
  const own = (pkg.tags || []).filter((t) => /^[A-Za-z][A-Za-z ]{2,24}$/.test(t)).map((t) => '#' + t.replace(/\s+/g, ''));
  return [...new Set(['#AncientEgypt', '#Egypt', '#History', ...own])].slice(0, 6).join(' ');
}

// owner's order 2026-11-13: ask a real question so people comment, never "like if"/"tag a friend" (Facebook and
// Instagram actually push that kind of post down, the opposite of what we want)
const ENGAGE = '💬 What part of this true story surprised you most?';

/** which: 'main' or 'R1'..'R3'. Two or three short lines about the subject, then the hashtags. */
export function postText(pkg, which) {
  const story = sentences(storyOf(pkg));
  if (which === 'main') return `${pkg.title}\n\n${story.slice(0, 2).join(' ')}\n\n${ENGAGE}\n\n${hashtags(pkg)}`;
  const reel = (pkg.reels || []).find((r) => r.id === `${pkg.id}-${which}`) || {};
  const about = reel.sub || story[0] || '';
  return `${reel.title || pkg.title}\n\n${about}\n\n${ENGAGE}\n\n${hashtags(pkg)}`;
}

/** Credits for the first comment: music, sources, picture and video credits, the AI note. */
export function creditText(pkg, max = 8000) {
  const d = String(pkg.description || '');
  const parts = [];
  const take = (label) => {
    const i = d.indexOf(`\n\n${label}`);
    if (i < 0) return;
    const rest = d.slice(i + 2);
    const end = rest.slice(label.length).search(/\n\n(Sources:|Music:|Narration voice|Image and video credits:)/);
    parts.push(end >= 0 ? rest.slice(0, end + label.length) : rest);
  };
  ['Music:', 'Image and video credits:', 'Sources:'].forEach(take);
  const ai = d.match(/\n\n(Narration voice[^\n]*)/);
  if (ai) parts.push(ai[1]);
  return parts.length ? `Credits\n\n${parts.join('\n\n')}`.slice(0, max) : '';
}
