const Assert = require('assert');
const Uuid = require('uuid')

const Geth = require('./geth');
const SafeMath = require('./safeMath');


/** Enforce the argument is a valid Ethereum address. Throws if it's not.
 * @param {string} address The string to check.
 */
function enforceAddress(address) {
  Assert.ok(/^0x[0-9a-fA-F]{40}$/.test(address), `Invalid blockchain address: ${address}`);
}


/** Constructor.
 * @param {string} bank The address of the bank owning the entire supply
 * @param {object} contractJson The ERC20 contract's combined object
 * @param {string?} erc20 The address or contract of the ERC20 token
 */
const ERC20 = module.exports = function(bank, contractJson, erc20) {
  Assert.strictEqual(typeof bank, 'string', `bank must be of type 'string'`);
  Assert.strictEqual(typeof contractJson, 'object', `contractJson must be of type 'object'`);
  enforceAddress(bank);

  this._txmap = {};
  this._balances = {};
  this._bank = bank;
  this._contractJson = contractJson;

  const erc20abi = JSON.parse(contractJson.abi);
  this._erc20instance = new Geth.UtilityChain.eth.Contract(erc20abi, erc20);
}


/** Deploy a new instance.
 * @param {number} supply The total supply, >0
 * @param {string} name The name of the token
 * @param {string} symbol The symbol of the token
 * @param {number} decimals The number of decimals for printing, 0≤n≤18
 */
ERC20.prototype.deploy = function(supply, name, symbol, decimals) {
  Assert.strictEqual(typeof name, 'string', `name must be of type 'string'`);
  Assert.strictEqual(typeof symbol, 'string', `symbol must be of type 'string'`);
  Assert.strictEqual(typeof decimals, 'number', `decimals must be of type 'number'`);
  Assert.strictEqual(typeof supply, 'number', `supply must be of type 'number'`);
  Assert.ok(decimals >= 0, "decimals must be ≥ 0");
  Assert.ok(decimals <= 18, "decimans must be ≤ 18");
  Assert.strictEqual(decimals, Math.trunc(decimals));
  Assert.ok(supply > 0, "supply must be > 0");
  Assert.ok(supply <= Number.MAX_SAFE_INTEGER, "supply integer overflow");
  Assert.strictEqual(supply, Math.trunc(supply));

  const oldAddress = this._btInstance.options.address;
  return Geth.UtilityChain.deployContract(this._bank, this._contractJson, oldAddress, symbol, name, decimals, supply);
}

/**
 * @returns {string} Name of token
 */
ERC20.prototype.name = function() {
  return this._erc20instance.methods.name().call();
}


/**
 * @returns {string} Symbol for token
 */
ERC20.prototype.symbol = function() {
  return this._erc20instance.methods.symbol().call();
}


/**
 * @returns {number} Number of decimals
 */
ERC20.prototype.decimals = function() {
  return this._erc20instance.methods.decimals().call()
    .then(str => Number(str))
}


/**
 * @returns {string} Total supply
 */
ERC20.prototype.totalSupply = function() {
  return this._erc20instance.methods.totalSupply().call()
}


  /**
 * @param {string} owner The address of the owner to check
 * @returns {Promise} Token balance for owner
 */
ERC20.prototype.balanceOf = function(owner) {
  Assert.strictEqual(typeof owner, 'string', `owner must be of type 'string'`);
  enforceAddress(owner);

  if (owner in this._balances) {
    // Pessimistic concurrency control
    return Promise.resolve(this._balances[owner]);
  }
  else {
    // Uncached balance; get it from chain
    return this._erc20instance.methods.balanceOf(owner).call()
      .then(balance => {
        Assert.ok(balance >= 0);
        Assert.strictEqual(owner in this._balances, false);
        return this._balances[owner] = Number(balance);
      });
  }
}


/**
 * @param {string} owner The address of the owner to check
 * @returns {number} Token allowance for owner
 */
ERC20.prototype.allowance = function(owner, spender) {
  Assert.strictEqual(typeof owner, 'string', `owner must be of type 'string'`);
  Assert.strictEqual(typeof spender, 'string', `spender must be of type 'string'`);
  enforceAddress(owner);
  enforceAddress(spender);

  return this._erc20instance.methods.allowance(owner, spender).call()
    .then(result => Number(result || 0));
}


/**
 * @param {string} sender The address of the sender
 * @param {string} to The address of the receiver
 * @param {number} value Number of tokens to transfer
 * @returns {string} New transaction ID
 */
ERC20.prototype.transfer = function(sender, to, value) {
  Assert.strictEqual(typeof sender, 'string', `sender must be of type 'string'`);
  Assert.strictEqual(typeof to, 'string', `to must be of type 'string'`);
  Assert.strictEqual(typeof value, 'number', `value must be of type 'number'`);
  Assert.ok(value > 0, "Invalid value");
  enforceAddress(sender);
  enforceAddress(to);

  const uuid = Uuid.v4();
  this._txmap[uuid] = 'pending';

  return this.balanceOf(sender).then(balance => {
    // Pessimistic concurrency control
    this._balances[sender] = SafeMath.sub(balance, value);

    Geth.UtilityChain.eth.personal.unlockAccount(sender).then(_ => {
      return this._erc20instance.methods.transfer(to, value).send({from: sender})
        .then(result => {
          Assert.strictEqual(result.events.Transfer.returnValues._from, sender);
          Assert.strictEqual(result.events.Transfer.returnValues._to, to);
          Assert.equal(result.events.Transfer.returnValues._value, value);
          this._balances[to] = SafeMath.add(this._balances[to], value);
          this._txmap[uuid] = result.transactionHash;
        })
    })
    .catch(err => {
      this._txmap[uuid] = err.message;
      this._balances[sender] = SafeMath.add(this._balances[sender], value);
    });

    return uuid;
  });
}


/**
 * @param {string} sender The address of the sender
 * @param {string} from The address of the spending account
 * @param {string} to The address of the receiver
 * @param {number} value Number of tokens to transfer
 * @returns {string} New transaction ID
 */
ERC20.prototype.transferFrom = function(sender, from, to, value) {
  Assert.strictEqual(typeof sender, 'string', `sender must be of type 'string'`);
  Assert.strictEqual(typeof from, 'string', `from must be of type 'string'`);
  Assert.strictEqual(typeof to, 'string', `to must be of type 'string'`);
  Assert.strictEqual(typeof value, 'number', `value must be of type 'number'`);
  Assert.ok(value > 0, "Invalid value");
  enforceAddress(sender);
  enforceAddress(from);
  enforceAddress(to);

  const uuid = Uuid.v4();
  this._txmap[uuid] = 'pending';

  return this.balanceOf(from).then(balance => {
    // Pessimistic concurrency control
    this._balances[from] = SafeMath.sub(balance, value);

    Geth.UtilityChain.eth.personal.unlockAccount(sender).then(_ => {
      return this._erc20instance.methods.transferFrom(from, to, value).send({from: sender})
        .then(result => {
          Assert.strictEqual(result.events.Transfer.returnValues._from, from);
          Assert.strictEqual(result.events.Transfer.returnValues._to, to);
          Assert.equal(result.events.Transfer.returnValues._value, value);
          this._balances[to] = SafeMath.add(this._balances[to], value);
          this._txmap[uuid] = result.transactionHash;
        })
    })
    .catch(err => {
      this._txmap[uuid] = err.message;
      this._balances[from] = SafeMath.add(this._balances[from], value);
    });

    return uuid;
  });
}


/**
 * @param {string} sender The address of the sender
 * @param {string} spender The address of the spender
 * @param {number} value Number of tokens to approve
 * @returns {string} New transaction ID
 */
ERC20.prototype.approve = function(sender, spender, value) {
  Assert.strictEqual(typeof sender, 'string', `sender must be of type 'string'`);
  Assert.strictEqual(typeof spender, 'string', `spender must be of type 'string'`);
  Assert.strictEqual(typeof value, 'number', `value must be of type 'number'`);
  Assert.ok(value >= 0, "Invalid value");
  enforceAddress(sender);
  enforceAddress(spender);

  const uuid = Uuid.v4();
  this._txmap[uuid] = 'pending';

  Geth.UtilityChain.eth.personal.unlockAccount(sender).then(_ => {
    return this._erc20instance.methods.approve(spender, value).send({from: sender})
      .then(result => {
        Assert.strictEqual(result.events.Approval.returnValues._owner, sender);
        Assert.strictEqual(result.events.Approval.returnValues._spender, spender);
        Assert.equal(result.events.Approval.returnValues._value, value);
        this._txmap[uuid] = result.transactionHash;
      })
  })
  .catch(err => {
    this._txmap[uuid] = err.message
  });

  return uuid;
}
