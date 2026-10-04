// [title: 速看小说公共模块]
// [name: sukanCore]
// [desc: 速看小说加解密、签名与请求公共能力]
// [author: sillyGirl]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

const crypto = require("crypto");
const PUBLIC =
    "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDFxo8kt6ftwFZ5QSXuVUOrQvYp\n4fLVQb3uK/sgYwuR0A+rYdp97UsrjVWGjUQBUhKvjhDcJ8MIY22FJ4y1m/qmbHAe\nNytfuP1pSnb34MEFV5tGUNvozAX/teuVARBLrlk9lql3ipJFKj0LWuZa7eHhX26O\ndyXDjuA+Xw0hkEuW2QIDAQAB\n-----END PUBLIC KEY-----",
  PRIVATE =
    "-----BEGIN PRIVATE KEY-----\nMIICdQIBADANBgkqhkiG9w0BAQEFAASCAl8wggJbAgEAAoGBAMXGjyS3p+3AVnlB\nJe5VQ6tC9inh8tVBve4r+yBjC5HQD6th2n3tSyuNVYaNRAFSEq+OENwnwwhjbYUn\njLWb+qZscB43K1+4/WlKdvfgwQVXm0ZQ2+jMBf+165UBEEuuWT2WqXeKkkUqPQta\n5lrt4eFfbo53JcOO4D5fDSGQS5bZAgMBAAECgYAor4I/AXEQXeLsKtTMxMmY77uI\nPi0gZdfWqUGOFhIJOw4eKZEzGp++I+MWPPVieCnT55vcTmm2zg13uP0fVykmukWq\nZszG/ZNpPKYleOqnZOqQj7O3au8Ywz18F/pqD++PsUzxRVeXxSOOwmjQ0D2Pe/9y\nutz62pyiFGAzDsaI6QJBAMn8DeBT3AtcWuONdiHL3yC4NkGJDdyBbMOaWyvrcvUU\nZr13uS9mZO6pLTN6v9tkmPUdvYxcPTJ9wdGR7NcNPDsCQQD6qluGI2VAlz4s5UoD\nnelFKrwDPeiruE3I6wsrasK6h37DsAE6OrQgx2dm4yH7ntJHUlJCZ5ay1EBNfEex\ngQv7AkA1r2vUwxVKY7q4nqHWa8SbgrrRAmePw0qwVreC3erJHyoLk+XBpnqPQKIF\n+8tAueU5yTTXOLD/WZOJazrDEf5/AkBpwG+Ggu5Xtrcbd8ynA/sDHElf0MGVmNbw\nOgFnWs42pa1cX6fU6ilOXvIH3TFcF6A9SMS9kThpz9QlHJaek4P7AkAavQillA/w\nnrha9GsK5UFmzmwNfkjLLW4psAUsXOsqFXWMoxTd0xWuSbuVOzERpbFMBl1VoZQm\nD9BLSVOTNe+v\n-----END PRIVATE KEY-----",
  SMS = {
    device: "Redmi Note 11",
    firm: "Xiaomi",
    channelId: "731001",
    versionId: "101200017",
    p2: "731001",
    p3: "101200017",
    p4: "501617",
    p5: "16",
    p9: "2",
    p16: "Redmi Note 11",
    p21: "3",
    p22: "11",
    p25: "12030",
    p26: "36",
    p29: "zya3c0e0",
    p33: "com.zhangyue.app.shortplay.kakandj",
    p34: "navigationbar_is_min",
    p36: "a",
    d1: "8.0.2",
    pc: "10",
    rgt: "7",
  },
  TASK = {
    device: "V2359A",
    firm: "vivo",
    channelId: "801002",
    versionId: "80002056",
    p2: "801002",
    p3: "80002056",
    p4: "501656",
    p5: "19",
    p9: "0",
    p16: "V2359A",
    p21: "99",
    p22: "14",
    p25: "80002056",
    p26: "34",
    p29: "zycb1bdb",
    p33: "com.chaozh.xincao.only.sk",
    p34: "vivo",
    p36: "a",
    d1: "8.0.2",
    pc: "10",
    rgt: "7",
  };
function rsaEncrypt(v) {
  return crypto
    .publicEncrypt({ key: PUBLIC, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(String(v)))
    .toString("base64");
}
function rsaSign(v) {
  return crypto
    .sign("RSA-SHA1", Buffer.from(String(v)), { key: PRIVATE, padding: crypto.constants.RSA_PKCS1_PADDING })
    .toString("base64");
}
function desEncrypt(v, key) {
  const k = Buffer.alloc(8);
  Buffer.from(String(key)).copy(k, 0, 0, 8);
  const c = crypto.createCipheriv("des-ede3-cbc", Buffer.concat([k, k, k]), k);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(String(v), "utf8"), c.final()]).toString("base64");
}
module.exports = { PUBLIC, PRIVATE, SMS, TASK, rsaEncrypt, rsaSign, desEncrypt };
