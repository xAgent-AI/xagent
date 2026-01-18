import { spawn, ChildProcess } from 'child_process';
import { MCPServerConfig } from './types.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export class MCPServer {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private tools: Map<string, MCPTool> = new Map();
  private isConnected: boolean = false;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /**
   * Get transport type, supporting both 'transport' and 'type' fields
   * for MCP spec compatibility
   */
  private getTransportType(): 'stdio' | 'sse' | 'http' | undefined {
    return this.config.transport || this.config.type;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    const transportType = this.getTransportType();

    try {
      if (transportType === 'http' || transportType === 'sse') {
        await this.connectHttp();
      } else {
        await this.connectStdio();
      }

      this.isConnected = true;
      console.log(`✅ MCP Server connected`);
    } catch (error) {
      console.error(`❌ Failed to connect MCP Server:`, error);
      throw error;
    }
  }

  private async connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.command) {
        reject(new Error('Command is required for stdio transport'));
        return;
      }

      let toolsLoaded = false;
      const toolsLoadTimeout = 5000; // 5 seconds max wait

      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.on('error', (error) => {
        console.error('MCP Server error:', error);
        reject(error);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`MCP Server exited with code ${code}, signal ${signal}`);
        this.isConnected = false;
      });

      if (this.process.stdout) {
        this.process.stdout.on('data', (data) => {
          this.handleMessage(data.toString());
          // Check if tools have been loaded after each message
          if (!toolsLoaded && this.tools.size > 0) {
            toolsLoaded = true;
          }
        });
      }

      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          console.error('MCP Server stderr:', data.toString());
        });
      }

      this.sendMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          }
        }
      });

      // Wait for tools to be loaded or timeout
      const checkInterval = setInterval(() => {
        if (this.tools.size > 0) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        if (this.tools.size === 0) {
          console.warn('MCP Server tools not loaded within timeout');
        }
        resolve();
      }, toolsLoadTimeout);
    });
  }

  private async connectHttp(): Promise<void> {
    if (!this.config.url) {
      throw new Error('URL is required for HTTP/SSE transport');
    }

    const transportType = this.getTransportType();
    console.log(`Connecting to MCP Server at ${this.config.url} (${transportType})`);

    // Build headers with auth token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream, application/json',
      ...this.config.headers
    };

    if (this.config.authToken) {
      if (this.config.authToken.startsWith('Bearer ')) {
        headers['Authorization'] = this.config.authToken;
      } else {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }
    }

    if (transportType === 'sse') {
      // For SSE transport, use fetch with streaming to receive tools/list events
      await this.connectSSE(this.config.url, headers);
    } else {
      // For HTTP transport, use axios POST
      const axios = (await import('axios')).default;

      try {
        const response = await axios.post(
          this.config.url,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              }
            }
          },
          { headers }
        );

        // Some MCP servers return SSE-over-HTTP format, so we always call loadTools
        // which handles both regular JSON and SSE format responses
        await this.loadTools(headers);
      } catch (error: any) {
        console.error(`HTTP connection failed: ${error.message}`);
        if (error.response) {
          console.error(`Response status: ${error.response.status}`);
          if (error.response.data?.message) {
            console.error(`Server message: ${error.response.data.message}`);
          }
        }
        throw error;
      }
    }
  }

  private async connectSSE(url: string, headers: Record<string, string>): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Send initialize request first
      const initResponse = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            }
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!initResponse.ok) {
        throw new Error(`SSE initialize failed: ${initResponse.status} ${initResponse.statusText}`);
      }

      // For SSE endpoints, try to load tools via a separate POST request
      await this.loadTools(headers);

      // If no tools loaded, try reading from the response body if it's a stream
      if (this.tools.size === 0 && initResponse.body) {
        const reader = initResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                this.handleJsonRpcMessage(data);
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('SSE connection timed out');
      } else {
        console.error(`SSE connection failed: ${error.message}`);
      }
      throw error;
    }
  }

  private handleMessage(data: string): void {
    const lines = data.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        this.handleJsonRpcMessage(message);
      } catch (error) {
        console.warn('Failed to parse MCP message:', line);
      }
    }
  }

  private handleJsonRpcMessage(message: any): void {
    // Handle response format: {id: 1, result: {tools: [...]}}
    if (message.result && message.result.tools) {
      this.handleToolsList(message.result);
      return;
    }

    // Handle notification format: {method: 'tools/list', params: {...}}
    if (message.method === 'tools/list') {
      this.handleToolsList(message.params);
    } else if (message.method === 'notifications/initialized') {
      console.log('MCP Server initialized');
    }
  }

  private sendMessage(message: any): void {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  private handleToolsList(result: any): void {
    if (result && result.tools) {
      for (const tool of result.tools) {
        this.tools.set(tool.name, tool);
      }
      console.log(`Loaded ${result.tools.length} tools from MCP Server`);
    }
  }

  private async loadTools(headers?: Record<string, string>): Promise<void> {
    if (!this.config.url) {
      console.warn('No URL configured, cannot load tools');
      return;
    }

    const axios = (await import('axios')).default;

    try {
      const response = await axios.post(
        this.config.url,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
            ...headers
          },
          timeout: 10000
        }
      );

      let resultData = response.data;

      // Check if response is SSE format (starts with "id:" or "data:")
      const dataStr = response.data?.toString() || '';
      if (dataStr.startsWith('id:') || dataStr.startsWith('data:')) {
        // Parse SSE format: "id:1\nevent:message\ndata:{...}"
        const dataMatch = dataStr.match(/data:(\{.*\})/);
        if (dataMatch) {
          try {
            resultData = JSON.parse(dataMatch[1]);
          } catch (e: any) {
            console.error(`Failed to parse SSE data: ${e.message}`);
          }
        }
      }

      if (resultData?.result?.tools) {
        this.handleToolsList(resultData.result);
      } else if (resultData?.tools) {
        this.handleToolsList(resultData);
      } else if (resultData?.error) {
        console.error(`MCP tools/list error: ${resultData.error.message}`);
      }
    } catch (error: any) {
      console.error(`Failed to load MCP tools: ${error.message}`);
    }
  }

  async callTool(toolName: string, params: any): Promise<any> {
    if (!this.isConnected) {
      throw new Error('MCP Server is not connected');
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    const message = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    };

    if (this.getTransportType() === 'http' || this.getTransportType() === 'sse') {
      return await this.callToolHttp(message);
    } else {
      return await this.callToolStdio(message);
    }
  }

  private async callToolHttp(message: any): Promise<any> {
    const axios = (await import('axios')).default;

    try {
      const response = await axios.post(this.config.url!, message, {
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        timeout: this.config.timeout || 30000
      });

      return response.data.result;
    } catch (error: any) {
      throw new Error(`MCP Tool call failed: ${error.message}`);
    }
  }

  private async callToolStdio(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error('MCP Server process not running'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('MCP Tool call timeout'));
      }, this.config.timeout || 30000);

      const responseHandler = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === message.id) {
            clearTimeout(timeout);
            this.process?.stdout?.off('data', responseHandler);
            
            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result);
            }
          }
        } catch (error) {
          reject(error);
        }
      };

      this.process.stdout?.on('data', responseHandler);
      this.process.stdin?.write(JSON.stringify(message) + '\n');
    });
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.isConnected = false;
    this.tools.clear();
  }

  isServerConnected(): boolean {
    return this.isConnected;
  }
}

export class MCPManager {
  private servers: Map<string, MCPServer> = new Map();

  registerServer(name: string, config: MCPServerConfig): void {
    const server = new MCPServer(config);
    this.servers.set(name, server);
  }

  async connectServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP Server not found: ${name}`);
    }
    await server.connect();
  }

  async connectAllServers(): Promise<void> {
    const connectionPromises = Array.from(this.servers.entries()).map(
      async ([name, server]) => {
        try {
          await server.connect();
        } catch (error) {
          console.error(`Failed to connect MCP Server ${name}:`, error);
        }
      }
    );

    await Promise.all(connectionPromises);
  }

  disconnectServer(name: string): void {
    const server = this.servers.get(name);
    if (server) {
      server.disconnect();
    }
  }

  disconnectAllServers(): void {
    this.servers.forEach(server => server.disconnect());
  }

  getServer(name: string): MCPServer | undefined {
    return this.servers.get(name);
  }

  getAllServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get all registered server configurations (without connecting)
   * Used for generating system prompt without waiting for MCP initialization
   */
  getAllServerConfigs(): { name: string; config: MCPServerConfig }[] {
    return Array.from(this.servers.entries()).map(([name, server]) => ({
      name,
      config: (server as any).config
    }));
  }

  getAllTools(): Map<string, MCPTool> {
    const allTools = new Map<string, MCPTool>();

    this.servers.forEach((server, serverName) => {
      server.getTools().forEach(tool => {
        allTools.set(`${serverName}__${tool.name}`, tool);
      });
    });

    return allTools;
  }

  async callTool(toolName: string, params: any): Promise<any> {
    // Split only on the first __ to preserve underscores in tool names
    const firstUnderscoreIndex = toolName.indexOf('__');
    if (firstUnderscoreIndex === -1) {
      throw new Error(`Invalid tool name format: ${toolName}`);
    }
    const serverName = toolName.substring(0, firstUnderscoreIndex);
    const actualToolName = toolName.substring(firstUnderscoreIndex + 2);

    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP Server not found: ${serverName}`);
    }

    // Lazy connect if not connected
    if (!server.isServerConnected()) {
      await server.connect();
    }

    return await server.callTool(actualToolName, params);
  }

  getToolDefinitions(): any[] {
    const tools: any[] = [];

    this.servers.forEach((server, serverName) => {
      server.getTools().forEach(tool => {
        tools.push({
          type: 'function',
          function: {
            name: `${serverName}__${tool.name}`,
            description: tool.description,
            parameters: tool.inputSchema
          }
        });
      });
    });

    return tools;
  }
}

let mcpManagerInstance: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManagerInstance) {
    mcpManagerInstance = new MCPManager();
  }
  return mcpManagerInstance;
}
