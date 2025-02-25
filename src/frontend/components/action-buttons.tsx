import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Power } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface ActionButtonsProps {
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ActionButtons({
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect
}: ActionButtonsProps) {
  
  const handleConnectToggle = () => {
    if (isConnected) {
      onDisconnect();
    } else {
      onConnect();
    }
  }

  return (
    <div className="flex justify-center py-3 border-t">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={handleConnectToggle}
              disabled={isConnecting}
              className={cn(
                "px-4 py-2 font-medium gap-2",
                isConnected 
                  ? "bg-green-500 hover:bg-green-600 text-white" 
                  : "bg-red-500/10 hover:bg-red-500/20 text-red-500"
              )}
            >
              <div className="relative">
                <Power className="h-4 w-4" />
                {!isConnected && !isConnecting && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-px bg-red-500 rotate-45 transform origin-center" />
                  </div>
                )}
              </div>
              {isConnecting ? "Connecting..." : isConnected ? "Connected" : "Disconnected"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isConnected ? "Disconnect from the server" : "Connect to the server"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

