import { escapeHtml } from './utils.mjs';

export function buildHtml(book, cssPath = '/css/style.css', siteUrl = 'https://dev.antinazi.org') {
    const lang = book.language || 'en';
    const datePublished = book.datePublished || '';
    const description = book.description || '';
    const canonicalUrl = `${siteUrl}/literature/${encodeURIComponent(book.fileName)}/`;
    const ogImage = `${siteUrl}/images/png/og_social.png`;
    const ogDescription = escapeHtml(description || `${book.title} by ${book.author}`);

    // Render chapters with proper heading/paragraph distinction
    const chaptersHtml = book.chapters.map(ch => {
        const subsectionsHtml = ch.subsections.map(sub => {
            if (sub.type === 'heading') {
                return `      <h3 id="${sub.id}">${escapeHtml(sub.content)}</h3>`;
            }
            return `      <p>${escapeHtml(sub.content)}</p>`;
        }).join('\n');

        return `    <section aria-labelledby="${ch.id}">
      <h2 id="${ch.id}">${escapeHtml(ch.heading)}</h2>
${subsectionsHtml}
    </section>`;
    }).join('\n');

    let footnotesHtml = '';
    if (book.footnotes && book.footnotes.length > 0) {
        const items = book.footnotes.map(fn =>
            `      <li id="${fn.id}"><a href="#ref-${fn.num}" aria-label="Back to reference ${fn.num}">↩</a> ${escapeHtml(fn.text)}</li>`
        ).join('\n');
        footnotesHtml = `
    <section aria-labelledby="footnotes-heading">
      <h2 id="footnotes-heading">Footnotes</h2>
      <ol class="footnotes">
${items}
      </ol>
    </section>`;
    }

    const schemaLd = {
        '@context': 'https://schema.org',
        '@type': 'Book',
        name: book.title,
        author: {
            '@type': 'Person',
            name: book.author
        },
        inLanguage: lang,
        url: canonicalUrl,
    };
    if (datePublished) schemaLd.datePublished = datePublished;
    if (description) schemaLd.description = description;

    const breadcrumbSchema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Library', item: `${siteUrl}/library/` },
            { '@type': 'ListItem', position: 3, name: book.title, item: canonicalUrl }
        ]
    };

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#54428e" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#181424" media="(prefers-color-scheme: dark)">
  <meta name="description" content="${ogDescription}">
  <meta name="robots" content="index, follow">
  <meta name="referrer" content="strict-origin-when-cross-origin">

  <!-- iOS PWA -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Literature">

  <!-- Favicons -->
  <link rel="icon" href="/favicon-light.png" type="image/png" media="(prefers-color-scheme: light)">
  <link rel="icon" href="/favicon-dark.png" type="image/png" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon-light.svg" type="image/svg+xml" media="(prefers-color-scheme: light)">
  <link rel="icon" href="/favicon-dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">
  <link rel="apple-touch-icon" href="/images/png/apple-touch-icon-180x180.png" sizes="180x180">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(book.title)}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:locale" content="${lang}">
  <meta property="og:site_name" content="Antinazi Literature Library">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(book.title)} — ${escapeHtml(book.author)}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(book.title)}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image" content="${ogImage}">

  <!-- Canonical -->
  <link rel="canonical" href="${canonicalUrl}">

  <link rel="stylesheet" href="${cssPath}">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>${escapeHtml(book.title)} — ${escapeHtml(book.author)}</title>

  <script type="application/ld+json">
${JSON.stringify(schemaLd, null, 2).replace(/</g, '\\u003c')}
  </script>
  <script type="application/ld+json">
${JSON.stringify(breadcrumbSchema, null, 2).replace(/</g, '\\u003c')}
  </script>

  <script src="/sw-register.js" defer></script>
  <script>window.__BOOK_SLUG__ = ${JSON.stringify(book.fileName)};</script>
  <script src="/js/reader.js" defer></script>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header>
    <nav aria-label="Breadcrumb">
      <ul class="breadcrumbs">
        <li><a href="/" aria-label="Home">🏠</a></li>
        <li><a href="/library/" aria-label="Library">📚 Library</a></li>
        <li aria-current="page">${escapeHtml(book.title)}</li>
      </ul>
    </nav>
  </header>
  <main id="main-content">
    <article>
      <header>
        <h1>${escapeHtml(book.title)}</h1>
        <p class="byline">by <span class="author">${escapeHtml(book.author)}</span></p>
${datePublished ? `        <p class="pub-date">First published: <time datetime="${escapeHtml(datePublished)}">${escapeHtml(datePublished)}</time></p>` : ''}
      </header>
${chaptersHtml}
${footnotesHtml}
    </article>
  </main>
  <footer>
    <hr>
    <p class="site-tagline">Defending truth through literature.</p>
    <nav aria-label="Footer">
      <ul class="footer-links">
        <li><a href="/About">About</a></li>
        <li><a href="/Privacy-Policy">Privacy Policy</a></li>
        <li><a href="/Accessibility-Statement">Accessibility Statement</a></li>
        <li><a href="/Terms-of-Service">Terms of Service</a></li>
        <li><a href="/Gutenberg-License">Project Gutenberg License</a></li>
      </ul>
    </nav>
  </footer>
</body>
</html>
`;
}

export function buildHomepageHtml(siteUrl = 'https://dev.antinazi.org', cssPath = '/css/style.css') {
    const title = 'Antinazi Literature Library';
    const description = 'Public-domain anarchist and radical literature, accessible and offline-ready.';
    const canonicalUrl = `${siteUrl}/`;
    const ogImage = `${siteUrl}/images/png/og_social.png`;

    const schemaLd = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: title,
        url: canonicalUrl,
        description: description,
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#54428e" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#181424" media="(prefers-color-scheme: dark)">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index, follow">
  <meta name="referrer" content="strict-origin-when-cross-origin">

  <!-- iOS PWA -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Antinazi">

  <!-- Favicons -->
  <link rel="icon" href="/images/svg/favicon-light.svg" type="image/svg+xml" media="(prefers-color-scheme: light)">
  <link rel="icon" href="/images/svg/favicon-dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">
  <link rel="apple-touch-icon" href="/images/png/apple-touch-icon-180x180.png" sizes="180x180">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:locale" content="en">
  <meta property="og:site_name" content="Antinazi Literature Library">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(title)}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${ogImage}">

  <!-- Canonical -->
  <link rel="canonical" href="${canonicalUrl}">

  <link rel="stylesheet" href="${cssPath}">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>${escapeHtml(title)}</title>

  <script type="application/ld+json">
${JSON.stringify(schemaLd, null, 2).replace(/</g, '\\u003c')}
  </script>

  <script src="/sw-register.js" defer></script>
  <script src="/js/app.js" defer></script>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header>
    <nav aria-label="Main">
      <ul class="breadcrumbs">
        <li aria-current="page">🏠 Home</li>
      </ul>
    </nav>
  </header>
  <main id="main-content">
    <article>
      <header>
        <h1>${escapeHtml(title)}</h1>
        <p class="byline">Defending truth through literature.</p>
      </header>
      <section aria-labelledby="about-heading">
        <h2 id="about-heading">About</h2>
        <p>This library hosts public-domain anarchist and radical literature, converted into accessible HTML5 documents with offline capability via Progressive Web App technology.</p>
      </section>
      <section aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">Catalogue</h2>
        <div id="literature-list">
          <p>Literature listings will appear here.</p>
        </div>
      </section>
    </article>
  </main>
  <footer>
    <hr>
    <p class="site-tagline">Defending truth through literature.</p>
    <nav aria-label="Footer">
      <ul class="footer-links">
        <li><a href="/About">About</a></li>
        <li><a href="/Privacy-Policy">Privacy Policy</a></li>
        <li><a href="/Accessibility-Statement">Accessibility Statement</a></li>
        <li><a href="/Terms-of-Service">Terms of Service</a></li>
        <li><a href="/Gutenberg-License">Project Gutenberg License</a></li>
      </ul>
    </nav>
  </footer>
</body>
</html>
`;
}
