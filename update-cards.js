const fs = require('fs');
const https = require('https');

const whiteCardsUrl = 'https://docs.google.com/document/d/1U0CDTsZrcyLgWbOsSQHOkHjYccA--CM8ZnDbS2VeIQs/export?format=txt';
const blackCardsUrl = 'https://docs.google.com/document/d/1FYiq1pOaXE04EEOzZxT2im1Q5C0Pp3mfhrv2aQvzkCI/export?format=txt';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return https.get(res.headers.location, (redirectRes) => {
          let data = '';
          redirectRes.on('data', chunk => data += chunk);
          redirectRes.on('end', () => resolve(data));
          redirectRes.on('error', reject);
        }).on('error', reject);
      }
      
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function processCards(text) {
  // Split by newline
  const lines = text.split(/\r?\n/);
  // Filter out empty lines, BOM characters, and trim whitespace
  return lines
    .map(line => line.replace(/^\uFEFF/, '').trim())
    .filter(line => line.length > 0 && line !== '---' && line !== '​')
    .map(line => {
      // Remove any leading bullets or numbers if they exist (though CAH cards usually don't have them)
      // Actually, just return the text but sanitize quotes
      return line.replace(/"/g, '\\"');
    });
}

async function updateCards() {
  try {
    console.log('Downloading White Cards...');
    const whiteText = await fetchText(whiteCardsUrl);
    const whiteCards = processCards(whiteText);
    console.log(`Found ${whiteCards.length} white cards.`);

    console.log('Downloading Black Cards...');
    const blackText = await fetchText(blackCardsUrl);
    const blackCards = processCards(blackText);
    console.log(`Found ${blackCards.length} black cards.`);

    const fileContent = `// Cards Against Humanity - Deck de Cartas em Português do Brasil (Customizado via Google Docs)

const blackCards = [
  "${blackCards.join('",\n  "')}"
];

const whiteCards = [
  "${whiteCards.join('",\n  "')}"
];

module.exports = { blackCards, whiteCards };
`;

    fs.writeFileSync('cards.js', fileContent, 'utf8');
    console.log('cards.js successfully updated!');
    
    // Also save a report of what was found
    fs.writeFileSync('cards_summary.txt', `White cards: ${whiteCards.length}\nBlack cards: ${blackCards.length}`, 'utf8');
  } catch (err) {
    console.error('Error fetching cards:', err);
  }
}

updateCards();
