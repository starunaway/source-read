const packageName = require('./package.json').name;

module.exports = {
  configureWebpack: {
    output: {
      library: `${packageName}-[name]`,
      libraryTarget: 'umd',
      jsonpFunction: `webpackJsonp_${packageName}`,
    },
  },

  devServer: {
    port: 3002,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
};
