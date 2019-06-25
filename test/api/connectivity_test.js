/*
 * Copyright 2019 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

const options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
};
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const _ = require('lodash');
const anyGrpc = require('../any_grpc');
const clientGrpc = anyGrpc.client;
const serverGrpc = anyGrpc.server;
const protoLoader = require('../../packages/proto-loader', options);
const testServiceDef = protoLoader.loadSync(__dirname + '/../proto/test_service.proto');
const TestService = serverGrpc.loadPackageDefinition(testServiceDef).TestService.service;
const TestServiceClient = clientGrpc.loadPackageDefinition(testServiceDef).TestService;

const clientCreds = clientGrpc.credentials.createInsecure();
const serverCreds = serverGrpc.ServerCredentials.createInsecure();

const serviceImpl = {
  unary: function(call, cb) {
    cb(null, {});
  },
  clientStream: function(stream, cb){
    stream.on('data', function(data) {});
    stream.on('end', function() {
      cb(null, {});
    });
  },
  serverStream: function(stream) {
    stream.end();
  },
  bidiStream: function(stream) {
    stream.on('data', function(data) {});
    stream.on('end', function() {
      stream.end();
    });
  }
};

describe('Reconnection', function() {
  let server1;
  let server2;
  let port;
  before(function() {
    server1 = new serverGrpc.Server();
    server1.addService(TestService, serviceImpl);
    server2 = new serverGrpc.Server();
    server2.addService(TestService, serviceImpl);
    port = server1.bind('localhost:0', serverCreds);
    server1.start();
    client = new TestServiceClient(`localhost:${port}`, clientCreds);
  });
  after(function() {
    server1.forceShutdown();
    server2.forceShutdown();
  });
  it('Should end with either OK or UNAVAILABLE when querying a server that is shutting down', function(done) {
    let pendingCalls = 0;
    let testDone = false;
    function maybeDone() {
      if (testDone && pendingCalls === 0) {
        done();
      }
    };
    client.unary({}, (err, data) => {
      assert.ifError(err);
      server1.tryShutdown(() => {
        server2.bind(`localhost:${port}`, serverCreds);
        server2.start();
        client.unary({}, (err, data) => {
          assert.ifError(err);
          clearInterval(callInterval);
          testDone = true;
          maybeDone();
        });
      });
      let callInterval = setInterval(() => {
        pendingCalls += 1;
        client.unary({}, (err, data) => {
          pendingCalls -= 1;
          if (err) {
            assert.strictEqual(err.code, clientGrpc.status.UNAVAILABLE);
          }
          maybeDone();
        });
      }, 0);
    });
  });
});