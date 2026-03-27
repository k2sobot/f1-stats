# F1 Stats

Live Formula 1 statistics dashboard with real-time data from the OpenF1 API.

## Features

- **Driver Standings** - Current season driver championship standings
- **Constructor Standings** - Current season constructor championship standings
- **Next Race** - Upcoming race schedule with session times
- **Latest Results** - Most recent session results with lap times
- **Dark/Light Mode** - Toggle between themes, persists preference
- **Client-side Caching** - Reduces API calls with smart caching
- **Responsive Design** - Works on desktop and mobile

## Live Demo

Visit the live site at: `https://[username].github.io/f1-stats/`

## Data Source

All data comes from the [OpenF1 API](https://openf1.org/) - a free, open-source API for Formula 1 data.

## Tech Stack

- Pure HTML, CSS, JavaScript (no frameworks)
- OpenF1 API for live data
- GitHub Pages for hosting
- Client-side caching to minimize API calls

## Local Development

1. Clone the repo
2. Open `docs/index.html` in a browser
3. Or serve with: `npx serve docs`

## API Caching

To avoid hitting API rate limits:
- Standings: 5 minute cache
- Schedule: 1 hour cache
- Latest session: 2 minute cache

Manual refresh button clears all caches.

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT License - feel free to use for your own projects.
