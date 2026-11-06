// Copyright 2026 Google LLC
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     https://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { getWebSocketUrl, getSessionId } from "@/lib/config"
import { startAudioPlayerWorklet } from "@/lib/audio-player"
import { startAudioRecorderWorklet } from "@/lib/audio-recorder"
import { AudioCallInterface, Message } from "@/components/audio-call-interface"
import {
  AppointmentScheduler,
  AppointmentSchedulerData,
} from "./appointment-scheduler"
import {
  MobileNotification,
  MobileNotificationData,
} from "./agent-execution-confirmation-notification"

import { AgentStatus } from "@/components/agent-status" 
import { HistoryMenu, TranscriptItem } from "@/components/HistoryMenu"
import { ProfileMenu } from "@/components/ProfileMenu"
import StatusBar from "@/components/StatusBar"

export default function AudioCallPageContent() {
  const [isAudio, setIsAudio] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const startingAudio = useRef(false)
  const audioResources = useRef<{ ws?: WebSocket; player?: AudioWorkletNode; recorder?: AudioWorkletNode; stream?: MediaStream }>({})
  const [notificationText, setNotificationText] = useState<string | undefined>()
  const [transcription, setTranscription] = useState<{ user: string; agent: string }>({ user: '', agent: '' })
  const [showScheduler, setShowScheduler] = useState(false)
  const [schedulerData, setSchedulerData] =
    useState<AppointmentSchedulerData | null>(null)
  const [notificationData, setNotificationData] =
    useState<MobileNotificationData | null>(null)
  const [showNotification, setShowNotification] = useState(false)
  const [currentVisual, setCurrentVisual] = useState<Message['visual'] | null>(null);
  const [audioPlayerNode, setAudioPlayerNode] = useState<AudioWorkletNode | null>(null)
  const [, setAudioRecorderNode] = useState<AudioWorkletNode | null>(null)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [isUserMuted, setIsUserMuted] = useState(false)
  const [inputAudioContext, setInputAudioContext] = useState<AudioContext | null>(null)
  const [outputAudioContext, setOutputAudioContext] = useState<AudioContext | null>(null)
  const audioQueue = useRef<ArrayBuffer[]>([])
  const websocketRef = useRef<WebSocket | null>(null)
  const audioPlayerNodeRef = useRef<AudioWorkletNode | null>(null)
  const currentUserMessageIdRef = useRef<string | null>(null)
  const currentAgentMessageIdRef = useRef<string | null>(null)
  const isInterruptedRef = useRef<boolean>(false)
  
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [isFetching, setIsFetching] = useState(false);
  const isEffectivelyMuted = isUserMuted
  const searchParams = useSearchParams()

  const startConversation = useCallback(async (notificationText?: string) => {
    if (isAudio || startingAudio.current) return
    startingAudio.current = true
    if (notificationText) {
      setNotificationText(notificationText)
    }
    setIsUserMuted(false)
    setAudioError(null)
    
    let inputContext: AudioContext | undefined
    let outputContext: AudioContext | undefined
    try {
      // Create contexts at the rates expected by the backend.
      inputContext = new AudioContext({ sampleRate: 16000 })
      outputContext = new AudioContext({ sampleRate: 24000 })
      await Promise.all([inputContext.resume(), outputContext.resume()])
      setInputAudioContext(inputContext)
      setOutputAudioContext(outputContext)

      setIsAudio(true)
    } catch (error) {
      if (inputContext && inputContext.state !== "closed") void inputContext.close()
      if (outputContext && outputContext.state !== "closed") void outputContext.close()
      setAudioError(error instanceof Error ? error.message : "Audio initialization failed")
      console.error("Audio Context initialization failed:", error)
    } finally {
      startingAudio.current = false
    }
  }, [isAudio]);

  useEffect(() => {
    setNotificationText(searchParams.get('notification_text') || undefined);
  }, [searchParams]);

  useEffect(() => {
    if (micStream) {
      micStream.getAudioTracks().forEach((track) => {
        track.enabled = !isEffectivelyMuted
      })
    }
  }, [isEffectivelyMuted, micStream])

  const handleRestore = (transcript: TranscriptItem[]) => {
    console.log("Restoring transcript is not fully supported in this view.", transcript)
  };

  const sendMessage = (message: object, ws: WebSocket) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const messageJson = JSON.stringify(message)
      ws.send(messageJson)
    } else {
      console.log("WebSocket not open. ReadyState:", ws?.readyState)
    }
  }

  const sendTextMessage = (text: string) => {
    if (websocketRef.current) {
      sendMessage({
        mime_type: "text/plain",
        data: text,
      }, websocketRef.current);
    }
  }

  const sendFile = async (file: File) => {
    setTranscription(prev => ({ ...prev, user: prev.user + `Uploading file: ${file.name}` }));
    console.log(`Uploading file: ${file.name}, size: ${file.size}, type: ${file.type}`);

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result && websocketRef.current) {
        const arrayBuffer = event.target.result as ArrayBuffer;
        sendMessage({
          mime_type: file.type,
          name: "user_upload",
          data: arrayBufferToBase64(arrayBuffer),
        }, websocketRef.current);
      }
    };
    reader.readAsArrayBuffer(file);

    if (websocketRef.current) {
    sendMessage({
        mime_type: "text/plain",
        data: `The user has uploaded a file named user_upload.`,
    }, websocketRef.current);
    }
  };

  const base64ToArray = (base64: string) => {
    const binaryString = window.atob(base64)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  }

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = ""
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }

  const audioRecorderHandler = useCallback((pcmData: ArrayBuffer, ws: WebSocket) => {
    sendMessage(
      {
        mime_type: "audio/pcm;rate=16000",
        data: arrayBufferToBase64(pcmData),
      },
      ws,
    )
  }, [])

  const stopAudioPlayer = useCallback(() => {
    audioPlayerNodeRef.current?.port.postMessage({ command: "stopAudio" })
  }, [])

  const startAudio = useCallback(async (ws: WebSocket, inputContext: AudioContext, outputContext: AudioContext) => {
    try {
      const [player] = await startAudioPlayerWorklet(outputContext)
      if (ws.readyState !== WebSocket.OPEN || websocketRef.current !== ws) { player.disconnect(); return }
      audioResources.current.player = player
      audioPlayerNodeRef.current = player
      setAudioPlayerNode(player)
      const [recorder, , stream] = await startAudioRecorderWorklet(
        inputContext,
        (pcmData: ArrayBuffer) => audioRecorderHandler(pcmData, ws),
        stopAudioPlayer,
        setIsUserSpeaking,
      )
      if (ws.readyState !== WebSocket.OPEN || websocketRef.current !== ws) {
        recorder.disconnect()
        stream.getTracks().forEach(track => track.stop())
        return
      }
      audioResources.current.recorder = recorder
      audioResources.current.stream = stream
      setAudioRecorderNode(recorder)
      setMicStream(stream)
    } catch (error) {
      if (websocketRef.current !== ws) return
      setAudioError(error instanceof Error ? error.message : "Microphone capture failed")
      setIsAudio(false)
      ws.close()
    }
  }, [audioRecorderHandler, stopAudioPlayer])

  const toggleMute = () => {
    setIsUserMuted((prevState) => !prevState)
  }

  useEffect(() => {
    if (audioPlayerNode && audioQueue.current.length > 0) {
      audioQueue.current.forEach((data) => audioPlayerNode.port.postMessage(data));
      audioQueue.current = [];
    }
  }, [audioPlayerNode]);

  // Notification changes reconnect the socket but retain this session's contexts.
  // Close contexts only when the session stops, replaces them, or unmounts.
  useEffect(() => {
    if (!isAudio || !inputAudioContext || !outputAudioContext) return
    return () => {
      if (inputAudioContext.state !== "closed") void inputAudioContext.close()
      if (outputAudioContext.state !== "closed") void outputAudioContext.close()
    }
  }, [isAudio, inputAudioContext, outputAudioContext])

  useEffect(() => {
    if (isAudio && inputAudioContext && outputAudioContext) {
      const sessionId = getSessionId();
      const ws_url = getWebSocketUrl();
      let url = `${ws_url}/${sessionId}?is_audio=False`;
      if (notificationText) {
        url += `&notification_text=${encodeURIComponent(notificationText)}`;
      }
      console.log(`Attempting to connect to WebSocket at: ${url}`);
      const ws = new WebSocket(url);
      websocketRef.current = ws;
      audioResources.current = { ws };
      audioQueue.current = [];
      isInterruptedRef.current = false;

      ws.onopen = () => {
        console.log("WebSocket connection opened.");
        startAudio(ws, inputAudioContext, outputAudioContext)
      }

      ws.onmessage = (event) => {
        const message_from_server = JSON.parse(event.data)

        if (message_from_server.mime_type == "application/json") {
           // Handle Visual Status Updates
          if (message_from_server.data.visual?.type && message_from_server.data.visual.data === "fetching") {
              setIsFetching(true);
          }
           
          // Handle Tools / Visuals
          if (message_from_server.data.type === "cd_information") {
            setCurrentVisual({ type: "cd_information", data: message_from_server.data });
            return;
          }
          if (message_from_server.data.type === "appointment_scheduler") {
            setSchedulerData(message_from_server.data)
            setShowScheduler(true)
            return
          }
          if (message_from_server.data.type === "agent_execution_confirmation_notification") {
            setNotificationData(message_from_server.data)
            setShowNotification(true)
            return
          }
          if (message_from_server.data.type === "financial_summary_visual") {
            setCurrentVisual({ type: 'financial_summary_visual', data: message_from_server.data });
            return
          }
          if (message_from_server.data.type === "stock_performance_visual") {
            const rawText = message_from_server.data.raw_text;
            let parsedData = { stockName: "N/A", price: "N/A", ytdReturn: "N/A" };
            if (rawText) {
              try {
                // Strip markdown code blocks (e.g., ```json ... ```)
                const cleanText = rawText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
                const jsonData = JSON.parse(cleanText);
                
                // Handle if the model returns an array of stocks (take the first one for now as the UI is singular)
                const dataToUse = Array.isArray(jsonData) ? jsonData[0] : jsonData;

                parsedData = {
                  stockName: dataToUse?.stockName || "N/A",
                  price: dataToUse?.price || "N/A",
                  ytdReturn: dataToUse?.ytdReturn || "N/A",
                };
              } catch (e) {
                console.error("Failed to parse stock performance JSON:", rawText, e);
              }
            }
            setCurrentVisual({ type: 'stock_performance_visual', data: parsedData });
            return
          }

          if (message_from_server.data.turn_complete) {
            currentUserMessageIdRef.current = null
            currentAgentMessageIdRef.current = null
            setIsAgentSpeaking(false); // Assume agent stops speaking at turn complete
            return
          }
          if (message_from_server.data.interrupted) {
            if (audioPlayerNodeRef.current) {
              audioPlayerNodeRef.current.port.postMessage({ command: "stopAudio" })
            }
            isInterruptedRef.current = true
            audioQueue.current = [] 
            setIsAgentSpeaking(false);
            return
          }
        }

        if (message_from_server.mime_type == "audio/pcm") {
          if (isInterruptedRef.current) {
            return
          }
          setIsFetching(false);
          setIsAgentSpeaking(true); // Received audio, so agent is speaking
          
          const audioData = base64ToArray(message_from_server.data)
          if (audioPlayerNodeRef.current) {
            audioPlayerNodeRef.current.port.postMessage(audioData)
          } else {
            audioQueue.current.push(audioData)
          }
        }

        if (message_from_server.mime_type == "text/plain") {
          setIsFetching(false);
          const isUser = message_from_server.source === "user";
          if (isUser) {
            if (currentAgentMessageIdRef.current) { 
              currentAgentMessageIdRef.current = null;
            }
            if (!currentUserMessageIdRef.current) {
              currentUserMessageIdRef.current = "msg-" + Math.random().toString(36).substring(7);
            }
            setTranscription(prev => ({ ...prev, user: prev.user + message_from_server.data }));
          } else { // agent
            setIsAgentSpeaking(true);
            if (currentUserMessageIdRef.current) { 
              currentUserMessageIdRef.current = null;
            }
            if (!currentAgentMessageIdRef.current) {
              currentAgentMessageIdRef.current = "msg-" + Math.random().toString(36).substring(7);
              isInterruptedRef.current = false;
            }
            setTranscription(prev => ({ ...prev, agent: prev.agent + message_from_server.data }));
          }
        }
      }

      ws.onclose = (event) => {
        console.log("WebSocket connection closed.", event.code, event.reason)
        setIsAgentSpeaking(false)
        setIsAudio(false)
        setAudioError(previous => previous || "The audio connection closed. Retry to reconnect.")
      }

      ws.onerror = (e) => {
        console.log("WebSocket error: ", e)
        setAudioError("Unable to connect to the audio service. Retry to reconnect.")
      }

      return () => {
        // Ignore late events from a socket being replaced or unmounted.
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
        ws.close()
        if (websocketRef.current === ws) websocketRef.current = null
        if (audioResources.current.ws === ws) {
          audioResources.current.stream?.getTracks().forEach(track => track.stop())
          audioResources.current.recorder?.disconnect()
          audioResources.current.player?.disconnect()
          audioResources.current = {}
          audioPlayerNodeRef.current = null
        }
        audioQueue.current = []
      }
    }
  }, [isAudio, inputAudioContext, outputAudioContext, notificationText, startAudio]);



  const handleCloseScheduler = () => {
    setShowScheduler(false)
    setSchedulerData(null)
  }

  const handleConfirmNotification = () => {
    setShowNotification(false)
    setNotificationData(null)
  }

  const handleCancelNotification = () => {
    setShowNotification(false)
    setNotificationData(null)
  }

  const transcriptionMessages: Message[] = useMemo(() => [
    ...(transcription.user ? [{ source: 'user' as const, data: transcription.user }] : []),
    ...(transcription.agent ? [{
      source: 'agent' as const,
      data: transcription.agent,
      visual: currentVisual || undefined,
    }] : []),
  ], [transcription.user, transcription.agent, currentVisual]);

  useEffect(() => {
    if (currentVisual && !transcriptionMessages.some(m => m.visual?.type === currentVisual.type)) {
      setCurrentVisual(null);
    }
  }, [transcriptionMessages, currentVisual]);

  return (
    <div className="audio-call-container">
      {audioError && <div role="alert" className="absolute left-4 right-4 top-24 z-[60] bg-red-950 p-4 text-white">
        {audioError}
        <button className="ml-4 underline" onClick={() => startConversation(notificationText)}>Retry audio</button>
      </div>}
      {!isAudio && !audioError && <div className="absolute left-4 right-4 top-24 z-[60] p-4 text-center">
        <button className="rounded bg-white px-4 py-2 text-black" onClick={() => startConversation(notificationText)}>
          Start audio conversation
        </button>
      </div>}
      <StatusBar />
      <div
        style={{
          borderRadius: '20px',
          position: 'absolute',
          width: '100%',
          height: '606px',
          left: '50%',
          bottom: '0px',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000000 100%)',
        }}
      ></div>
      <div className="header-container">
        <div className="header-content-wrapper" style={{ backgroundColor: '#B19658'}}>
          <HistoryMenu onRestore={handleRestore} />
          {!isAudio && (
            <Link href="/" passHref>
              <div className="text-white font-bold text-xl px-4 cursor-pointer">
                Wealth App
              </div>
            </Link>
          )}
          {isAudio && (
            <Link href="/" passHref>
               <div className="text-white font-bold text-xl px-4 cursor-pointer">
                Wealth App
              </div>
            </Link>
          )}
          <ProfileMenu />
        </div>
      </div>
      <div className="relative w-full h-full flex flex-col">
        <div className={isAudio ? "flex-1 flex items-center justify-center p-8 overflow-hidden" : "hidden"}>

          
          <AgentStatus 
            isSpeaking={isAgentSpeaking}
            isListening={isAudio && !isAgentSpeaking}
          />

        </div>
        {showScheduler && schedulerData && (
          <AppointmentScheduler
            data={schedulerData}
            onClose={handleCloseScheduler}
          />
        )}
        {showNotification && notificationData && (
          <MobileNotification
            data={notificationData}
            onConfirm={handleConfirmNotification}
            onCancel={handleCancelNotification}
          />
        )}
        <div className="absolute bottom-0 w-full">
          <AudioCallInterface
            messages={transcriptionMessages}
            isAudio={isAudio}
            isMuted={isUserMuted}
            isFetching={isFetching}
            toggleMute={toggleMute}
            sendTextMessage={sendTextMessage}
            sendFile={sendFile}
            isTranscriptionVisible={true}
            isUserSpeaking={isUserSpeaking}
          />
        </div>
      </div>
    </div>
  );
}