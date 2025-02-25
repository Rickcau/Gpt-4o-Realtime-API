'use client'

import { useState, useEffect, useRef } from 'react'
import { nanoid } from 'nanoid'
import { Eraser, Send, User, Mic } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { MessageBubble } from '@/components/message-bubble'
import { ActionButtons } from '@/components/action-buttons'
import { ThemeToggle } from '@/components/theme-switcher'
import type { Message, ChatState, MessageRole } from '@/types/chat'
import { config } from '@/lib/config'
import { cn } from '@/lib/utils'
import { Player, Recorder } from "@/lib/audio"
import { WebSocketClient } from "@/lib/client"

// Define WebSocket message types
interface WSMessage {
  id?: string;
  type: "text_delta" | "transcription" | "user_message" | "control";
  delta?: string;
  text?: string;
  action?: "speech_started" | "connected" | "text_done";
  greeting?: string;
}

export default function ChatInterface() {
  const [chatState, setChatState] = useState<ChatState>({
    messages: [],
  })
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [microphoneActive, setMicrophoneActive] = useState(false)
  
  // WebSocket and audio states
  const [wsEndpoint] = useState('ws://localhost:8080/realtime')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  
  // Refs for WebSocket and audio handling
  const webSocketClient = useRef<WebSocketClient | null>(null)
  const audioPlayerRef = useRef<Player | null>(null)
  const audioRecorderRef = useRef<Recorder | null>(null)
  const messageMap = useRef(new Map<string, Message>())
  const currentUserMessage = useRef<Message>()

  // Initialize session ID on component mount
  useEffect(() => {
    setSessionId(nanoid())
    
    // Cleanup function to close connections on unmount
    return () => {
      disconnectWebSocket()
    }
  }, [])

  // Function to initialize audio player
  const initAudioPlayer = async () => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Player()
      await audioPlayerRef.current.init(24000)
    }
    return audioPlayerRef.current
  }
  
  // WebSocket disconnect function
  const disconnectWebSocket = async () => {
    setIsConnected(false)
    if (microphoneActive) {
      await handleToggleMicrophone()
    }
    
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop()
      audioRecorderRef.current = null
    }
    
    if (audioPlayerRef.current) {
      audioPlayerRef.current.clear()
    }
    
    if (webSocketClient.current) {
      await webSocketClient.current.close()
      webSocketClient.current = null
    }
  }

  // New functions for WebSocket handling
  const handleWSMessage = async (message: WSMessage) => {
    switch (message.type) {
      case "transcription":
        if (message.id && currentUserMessage.current) {
          currentUserMessage.current.content = message.text || ''
          setMessages()
        }
        break
      case "text_delta":
        if (message.id) {
          const existingMessage = messageMap.current.get(message.id)
          if (existingMessage) {
            existingMessage.content += message.delta || ''
          } else {
            // Always use 'assistant' role for new messages from the server
            const newMessage: Message = {
              id: message.id,
              role: 'assistant',
              content: message.delta || ''
            }
            messageMap.current.set(message.id, newMessage)
          }
          setMessages()
        }
        break
      case "control":
        if (message.action === "connected" && message.greeting) {
          // Add greeting message with assistant role
          const statusMessageId = `status-${Date.now()}`
          const statusMessage: Message = {
            id: statusMessageId,
            role: 'assistant',
            content: "You are now connected to the real-time processing server"
          }
          messageMap.current.set(statusMessageId, statusMessage)
          
          // Remove any potential "connecting" messages with status role
          const messagesToRemove: string[] = []
          messageMap.current.forEach((msg, key) => {
            if (msg.role === 'status' && msg.content.includes('Connecting')) {
              messagesToRemove.push(key)
            }
          })
          messagesToRemove.forEach(key => messageMap.current.delete(key))
          
          setMessages()
        } else if (message.action === "speech_started") {
          // User starts speaking
          audioPlayerRef.current?.clear()
          const contrivedId = "userMessage" + Math.random()
          currentUserMessage.current = {
            id: contrivedId,
            role: 'user',
            content: "..."
          }
          messageMap.current.set(contrivedId, currentUserMessage.current)
          setMessages()
        }
        break
    }
  }

  // Helper to set messages from the messageMap
  const setMessages = () => {
    // Ensure all messages have valid roles before setting state
    const messages = Array.from(messageMap.current.values()).map(message => {
      // Force all non-user messages to be either 'assistant' or 'status'
      if (message.role !== 'user' && message.role !== 'status') {
        return { ...message, role: 'assistant' as MessageRole };
      }
      return message;
    });
    
    setChatState(prev => ({
      ...prev,
      messages: messages
    }));
  }

  // WebSocket receive loop
  const receiveLoop = async () => {
    const player = await initAudioPlayer()
    if (!webSocketClient.current) return

    for await (const message of webSocketClient.current) {
      if (message.type === "text") {
        try {
          const data = JSON.parse(message.data) as WSMessage
          console.log("Received WebSocket message:", data)
          await handleWSMessage(data)
        } catch (error) {
          console.error("Error parsing WebSocket message:", error)
        }
      } else if (message.type === "binary" && player) {
        player.play(new Int16Array(message.data))
      }
    }
  }

  // Connect to WebSocket
  const handleConnect = async () => {
    if (isConnected) {
      await disconnectWebSocket()
      return
    }
    
    setIsConnecting(true)
    try {
      // Clear message map and add a connecting message
      messageMap.current.clear()
      const statusMessageId = `status-${Date.now()}`
      const statusMessage: Message = {
        id: statusMessageId,
        role: 'status',
        content: "Connecting..."
      }
      messageMap.current.set(statusMessageId, statusMessage)
      setMessages()
      
      // Create WebSocket connection
      webSocketClient.current = new WebSocketClient(new URL(wsEndpoint))
      setIsConnected(true)
      receiveLoop()
    } catch (error) {
      console.error("Connection failed:", error)
    } finally {
      setIsConnecting(false)
    }
  }

  // Update handleToggleMicrophone to actually record audio
  const handleToggleMicrophone = async () => {
    try {
      if (!microphoneActive && webSocketClient.current) {
        if (!audioRecorderRef.current) {
          audioRecorderRef.current = new Recorder(async (buffer) => {
            await webSocketClient.current?.send({ type: "binary", data: buffer })
          })
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            sampleRate: 24000,
          },
        })
        await audioRecorderRef.current.start(stream)
        setMicrophoneActive(true)
      } else if (audioRecorderRef.current) {
        await audioRecorderRef.current.stop()
        audioRecorderRef.current = null
        setMicrophoneActive(false)
      }
    } catch (error) {
      console.error("Error with microphone:", error)
      setMicrophoneActive(false)
    }
  }

  // Modify the handleSend function to use WebSocket
  const handleSend = async () => {
    if (!input.trim() || !isConnected || !webSocketClient.current) return

    const messageId = `user-${Date.now()}`
    const userMessage: Message = {
      id: messageId,
      content: input,
      role: 'user'
    }
    
    // Add message to UI
    messageMap.current.set(messageId, userMessage)
    setMessages()
    
    // Send via WebSocket
    const message = {
      type: "user_message",
      text: input,
    }
    await webSocketClient.current.send({
      type: "text",
      data: JSON.stringify(message),
    })
    
    // Clear input
    setInput('')
  }

  const handleClear = () => {
    messageMap.current.clear()
    setChatState({ messages: [] })
    setSessionId(nanoid())
  }

  return (
    <>
      <div className="flex h-screen w-full overflow-hidden">
        <div className="container mx-auto max-w-4xl p-4 flex flex-col h-full">
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="flex flex-col space-y-3 pb-4">
              <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold tracking-tight">Translator Assistant</h1>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div 
                      className={cn(
                        "w-2 h-2 rounded-full",
                        isConnected ? "bg-green-500" : isConnecting ? "bg-yellow-500" : "bg-red-500"
                      )} 
                    />
                    <span className="text-xs text-muted-foreground">
                      {isConnected ? "Connected" : isConnecting ? "Connecting..." : "Disconnected"}
                    </span>
                  </div>
                  <div className="h-4 w-px bg-border" />
                  <ThemeToggle />
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center text-sm">
                    <User className="h-4 w-4 mr-1.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{config.testUser}</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-2 mr-2">
                {chatState.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    content={message.content}
                    role={message.role}
                  />
                ))}
              </div>
              
              <div className="mt-auto">
                <ActionButtons 
                  isConnected={isConnected}
                  isConnecting={isConnecting}
                  onConnect={handleConnect}
                  onDisconnect={disconnectWebSocket}
                />
                
                <div className="relative">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your question here..."
                    className="pr-24 resize-none"
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                  />
                  <div className="absolute right-2 bottom-2 flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleClear}
                      title="Clear chat"
                    >
                      <Eraser className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant={microphoneActive ? "default" : "ghost"}
                      onClick={handleToggleMicrophone}
                      title={microphoneActive ? "Stop voice input" : "Start voice input"}
                      disabled={!isConnected}
                      className={cn(
                        microphoneActive 
                          ? "bg-green-500 hover:bg-green-600 text-white" 
                          : isConnected 
                            ? "bg-red-500/10 hover:bg-red-500/20 text-red-500"
                            : "bg-gray-200 text-gray-400"
                      )}
                    >
                      <div className="relative">
                        <Mic className="h-4 w-4" />
                        {!microphoneActive && isConnected && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-5 h-px bg-red-500 rotate-45 transform origin-center" />
                          </div>
                        )}
                      </div>
                    </Button>
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!input.trim() || !isConnected}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

