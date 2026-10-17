// Fixed deck order. Database IDs keep a bookmark's face stable across sorting/filtering.
export const clowDeck = [
  ["windy", "風", "风"], ["fly", "翔", "翔"], ["shadow", "影", "影"], ["watery", "水", "水"],
  ["rain", "雨", "雨"], ["wood", "樹", "树"], ["jump", "跳", "跳"], ["illusion", "幻", "幻"],
  ["silent", "静", "静"], ["thunder", "雷", "雷"], ["sword", "剣", "剑"], ["flower", "花", "花"],
  ["shield", "盾", "盾"], ["time", "時", "时"], ["power", "力", "力"], ["mist", "霧", "雾"],
  ["storm", "嵐", "岚"], ["float", "浮", "浮"], ["erase", "消", "消"], ["glow", "灯", "灯"],
  ["move", "移", "移"], ["fight", "闘", "斗"], ["loop", "輪", "轮"], ["sleep", "眠", "眠"],
  ["song", "歌", "歌"], ["little", "小", "小"], ["mirror", "鏡", "镜"], ["maze", "迷", "迷"],
  ["return", "戻", "返"], ["shot", "撃", "击"], ["sweet", "甘", "甘"], ["dash", "駆", "驱"],
  ["big", "大", "大"], ["create", "創", "创"], ["change", "替", "替"], ["freeze", "凍", "冻"],
  ["firey", "火", "火"], ["snow", "雪", "雪"], ["arrow", "矢", "矢"], ["bubbles", "泡", "泡"],
  ["through", "抜", "拔"], ["wave", "波", "波"], ["libra", "秤", "秤"], ["voice", "声", "声"],
  ["lock", "錠", "锁"], ["cloud", "雲", "云"], ["dream", "夢", "梦"], ["sand", "砂", "砂"],
  ["light", "光", "光"], ["dark", "闇", "暗"], ["twin", "双", "双"], ["earthy", "地", "地"],
].map(([key, glyph, name]) => ({ key, glyph, name }));

export function cardForBookmark(id: number) {
  return clowDeck[((Math.trunc(id) - 1) % clowDeck.length + clowDeck.length) % clowDeck.length];
}
