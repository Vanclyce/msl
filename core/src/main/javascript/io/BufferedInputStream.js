/**
 * Copyright (c) 2017 Netflix, Inc.  All rights reserved.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * <p>A {@code BufferedInputStream} adds support for the {@code mark()} and
 * {@code reset()} functions.</p>
 * 
 * @author Wesley Miaw <wmiaw@netflix.com>
 */
(function(require, module) {
    "use strict";
    
    var InputStream = require('../io/InputStream.js');
    var ByteArrayOutputStream = require('../io/ByteArrayOutputStream.js');
    var MslIoException = require('../MslIoException.js');
    var InterruptibleExecutor = require('../util/InterruptibleExecutor.js');

	var BufferedInputStream = module.exports = InputStream.extend({
		/**
		 * Create a new buffered input stream backed by the provided input
		 * stream.
		 * 
		 * @param {InputStream} source the backing input stream.
		 */
		init: function init(source) {
			// The properties.
			var props = {
			    _source: { value: source, writable: false, enumerable: false, configurable: false },
			    _buffer: { value: null, writable: true, enumerable: false, configurable: false },
			    _markpos: { value: 0, writable: true, enumerable: false, configurable: false },
			};
			Object.defineProperties(this, props);
		},
		
		/** @inheritDoc */
		abort: function abort() {
			this._source.abort();
		},
		
		/** @inheritDoc */
		close: function close(timeout, callback) {
			this._source.close(timeout, callback);
		},
		
		/** @inheritDoc */
		mark: function mark() {
			// If there is no current mark, then start buffering.
			if (!this._buffer) {
				this._buffer = new ByteArrayOutputStream();
				this._markpos = 0;
				return;
			}
			
			// If there is data buffered and the current mark position is not
			// zero (at the beginning) then truncate the the buffer.
			if (this._markpos > 0) {
				var data = this._buffer.toByteArray();
				this._buffer = new ByteArrayOutputStream();
				// ByteArrayOutputStream.write() is synchronous so we can get
				// away with this.
				this._buffer.write(data, this._markpos, data.length - this._markpos, -1, {
					result: function() {},
					timeout: function() {},
					error: function() {}
				});
				this._markpos = 0;
			}
			
			// Otherwise the existing buffer contains the correct data.
		},
		
		/** @inheritDoc */
		reset: function reset() {
			if (!this._buffer)
				throw new MslIoException("Cannot reset before input stream has been marked.");
			
			// Start reading from the beginning of the buffer. 
			this._markpos = 0;
		},
		
		/** @inheritDoc */
		markSupported: function markSupported() {
			return true;
		},
		
		/** @inheritDoc */
		read: function read(len, timeout, callback) {
			var self = this;
			
			InterruptibleExecutor(callback, function() {
	            if (this._closed)
	                throw new MslIoException("Stream is already closed.");
	            
				// If we have any data in the buffer, read it first.
				var bufferedData;
				if (this._buffer && this._buffer.size() > this._markpos) {
					// If no length was specified, read everything remaining
					// in the buffer.
					var endpos;
					if (len == -1) {
						endpos = this._buffer.size();
					}
					// Otherwise read the amount requested but no more than
					// what remains in the buffer. 
					else {
						endpos = Math.min(this._buffer.size(), this._markpos + len);
					}
					
					// Extract the buffered data.
					bufferedData = this._buffer.toByteArray().subarray(this._markpos, endpos);
					this._markpos += bufferedData.length;
					
					// If the data is of sufficient size, return it.
					if (bufferedData.length >= len)
						return bufferedData;
				} else {
					bufferedData = null;
				}
				
				// We were not able to read enough off the buffer.
				//
				// If a length was specified, read any remaining data off the
				// backing source.
				var remainingLength = -1;
				if (len != -1)
					remainingLength = len - ((bufferedData) ? bufferedData.length : 0);
				this._source.read(remainingLength, timeout, {
					result: function(data) {
						InterruptibleExecutor(callback, function() {
							var concatData = concatenate(bufferedData, data);
							return concatData;
						}, self);
					},
					timeout: function(data) {
						InterruptibleExecutor(callback, function() {
							var concatData = concatenate(bufferedData, data);
							callback.timeout(concatData);
						}, self);
					},
					error: callback.error,
				});
				
				function concatenate(bufferedData, sourceData) {
					// On end of stream, return the buffered data.
					if (!sourceData)
						return bufferedData;
					
					// Append to the buffer if we are buffering.
					//
					// ByteArrayOutputStream.write() is synchronous so
					// we can get away with this.
					if (self._buffer) {
						self._buffer.write(sourceData, 0, sourceData.length, -1, {
							result: function() {},
							timeout: function() {},
							error: function() {}
						});
						self._markpos += sourceData.length;
						// The mark position should now be equal to the
						// buffer length.
					}
					
					// If we didn't have any buffered data, return the
					// data directly.
					if (!bufferedData)
						return sourceData;
					
					// Otherwise return the buffered data and the read
					// data.
					var result = new Uint8Array(bufferedData.length + sourceData.length);
					result.set(bufferedData);
					result.set(sourceData, bufferedData.length);
					return result;
				}
			}, self);
		},
	});
})(require, (typeof module !== 'undefined') ? module : mkmodule('BufferedInputStream'));