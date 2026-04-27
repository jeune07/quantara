(async () => {
  try {
    const res = await fetch('https://www.mcmaster.com/products/cotter-pins/');
    console.log('Status:', res.status);
    const body = await res.text();
    console.log(body);
  } catch (err) {
    console.error('Fetch failed:', err);
  }
})();
