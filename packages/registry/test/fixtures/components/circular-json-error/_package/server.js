module.exports.data = function(context, callback) {
  var model = { name: 'John doe' };
  model.circular = model;
  callback(null, model);
};
