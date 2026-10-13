import type { Pass } from '../types.js';

/**
 * Links and images are resolved against the page URL, so that a ref copied out of the
 * Markdown can be passed back as it is. `javascript:` links and bare `#` links (script
 * navigation) keep their text and lose the link; `title` attributes are dropped because
 * they would be written into the link target.
 */
export const absolutize: Pass = ($, env) => {
  $('a[href]').each((_, el) => {
    const link = $(el);
    const href = (link.attr('href') ?? '').trim();
    if (href === '' || href === '#' || /^javascript:/i.test(href)) {
      link.replaceWith(link.contents());
      return;
    }
    const resolved = URL.parse(href, env.url);
    if (resolved !== null) link.attr('href', resolved.href);
    link.removeAttr('title');
  });
  $('img[src]').each((_, el) => {
    const image = $(el);
    const resolved = URL.parse(image.attr('src') ?? '', env.url);
    if (resolved !== null) image.attr('src', resolved.href);
    image.removeAttr('title');
  });
};
