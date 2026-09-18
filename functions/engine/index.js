'use strict';

module.exports = {
  ...require('./rng'),
  ...require('./answers'),
  ...require('./opponent'),
  ...require('./session'),
  ...require('./progression'),
  catalog: require('../shared/catalog.json')
};
