function styleHeader(ws) {
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function hyperlinkCell(cell, url, displayText) {
  cell.value = { text: displayText || url, hyperlink: url };
  cell.font = { color: { argb: 'FF0563C1' }, underline: true };
}

module.exports = { styleHeader, hyperlinkCell };
