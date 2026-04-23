/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1621095049")

  // add field
  collection.fields.addAt(1, new Field({
    "help": "",
    "hidden": false,
    "id": "number73075661",
    "max": null,
    "min": null,
    "name": "hero_id",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(2, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1579384326",
    "max": 0,
    "min": 0,
    "name": "name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "help": "",
    "hidden": false,
    "id": "json3057528519",
    "maxSize": 0,
    "name": "roles",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "help": "",
    "hidden": false,
    "id": "json2327159929",
    "maxSize": 0,
    "name": "lanes",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "help": "",
    "hidden": false,
    "id": "number1789278845",
    "max": null,
    "min": null,
    "name": "base_hp",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "help": "",
    "hidden": false,
    "id": "number1300567824",
    "max": null,
    "min": null,
    "name": "base_hp_regen",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "help": "",
    "hidden": false,
    "id": "number4139092162",
    "max": null,
    "min": null,
    "name": "base_mana",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "number2059097121",
    "max": null,
    "min": null,
    "name": "base_mana_regen",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "number181752224",
    "max": null,
    "min": null,
    "name": "phys_attack",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "number325732487",
    "max": null,
    "min": null,
    "name": "magic_power",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "help": "",
    "hidden": false,
    "id": "number3157633733",
    "max": null,
    "min": null,
    "name": "phys_defense",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "number241174212",
    "max": null,
    "min": null,
    "name": "magic_defense",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "help": "",
    "hidden": false,
    "id": "number4070320611",
    "max": null,
    "min": null,
    "name": "movement_speed",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2076546756",
    "max": 0,
    "min": 0,
    "name": "attack_type",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "help": "",
    "hidden": false,
    "id": "number3513416690",
    "max": null,
    "min": null,
    "name": "attack_speed",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2715591138",
    "max": 0,
    "min": 0,
    "name": "primary_damage_type",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "help": "",
    "hidden": false,
    "id": "json3576764016",
    "maxSize": 0,
    "name": "skills",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "help": "",
    "hidden": false,
    "id": "json2778319940",
    "maxSize": 0,
    "name": "specialty_tags",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text999377416",
    "max": 0,
    "min": 0,
    "name": "patch_version",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(20, new Field({
    "help": "",
    "hidden": false,
    "id": "date2685905599",
    "max": "",
    "min": "",
    "name": "last_updated",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(21, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2776776943",
    "max": 0,
    "min": 0,
    "name": "source_url",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text3326257992",
    "max": 0,
    "min": 0,
    "name": "data_confidence",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1621095049")

  // remove field
  collection.fields.removeById("number73075661")

  // remove field
  collection.fields.removeById("text1579384326")

  // remove field
  collection.fields.removeById("json3057528519")

  // remove field
  collection.fields.removeById("json2327159929")

  // remove field
  collection.fields.removeById("number1789278845")

  // remove field
  collection.fields.removeById("number1300567824")

  // remove field
  collection.fields.removeById("number4139092162")

  // remove field
  collection.fields.removeById("number2059097121")

  // remove field
  collection.fields.removeById("number181752224")

  // remove field
  collection.fields.removeById("number325732487")

  // remove field
  collection.fields.removeById("number3157633733")

  // remove field
  collection.fields.removeById("number241174212")

  // remove field
  collection.fields.removeById("number4070320611")

  // remove field
  collection.fields.removeById("text2076546756")

  // remove field
  collection.fields.removeById("number3513416690")

  // remove field
  collection.fields.removeById("text2715591138")

  // remove field
  collection.fields.removeById("json3576764016")

  // remove field
  collection.fields.removeById("json2778319940")

  // remove field
  collection.fields.removeById("text999377416")

  // remove field
  collection.fields.removeById("date2685905599")

  // remove field
  collection.fields.removeById("text2776776943")

  // remove field
  collection.fields.removeById("text3326257992")

  return app.save(collection)
})
