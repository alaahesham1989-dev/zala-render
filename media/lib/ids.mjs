// The videos to make, as a JSON list for the job matrix: valid names only, each once, order kept.
console.log(JSON.stringify([...new Set(process.argv.slice(2).filter((s) => /^[A-Za-z0-9-]+$/.test(s)))]));
