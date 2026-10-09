import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useI18n } from '@/i18n/useI18n';
import { AssistantMessage, ContextDivider, UserMessage } from './MessageItem';
import { WelcomeScreen } from './WelcomeScreen';
import { Composer } from './Composer';
import { WorkspacePanel } from '@/components/layout/WorkspacePanel';
import { classNames } from '@/lib/format';

const SCROLL_THRESHOLD = 80;

export function ChatView() {
  const { t } = useI18n();
  const { messages, streaming, addFiles } = useChat();
  const { workspacePanelOpen } = useUI();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || autoScroll) el.scrollTop = el.scrollHeight;
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(dist > SCROLL_THRESHOLD);
    setAutoScroll(dist <= SCROLL_THRESHOLD);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (files && files.length) void addFiles(files);
  };

  const showWelcome = messages.length === 0 && !streaming;

  return (
    <>
      <div
        id="chat-main"
        className={classNames('chat-main relative', dragActive && 'ws-drop-active')}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounter.current += 1;
          setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) setDragActive(false);
        }}
        onDrop={onDrop}
      >
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          {showWelcome ? (
            <WelcomeScreen />
          ) : (
            <div className="py-2">
              {messages.map((msg, i) =>
                msg.divider ? (
                  <ContextDivider key={msg.seq ?? `div-${i}`} message={msg} />
                ) : msg.role === 'user' ? (
                  <UserMessage key={msg.seq ?? `u-${i}`} message={msg} />
                ) : (
                  <AssistantMessage key={msg.seq ?? `a-${i}`} message={msg} />
                ),
              )}
              {streaming ? (
                <AssistantMessage
                  streaming
                  message={{
                    role: 'assistant',
                    content: streaming.content,
                    timestamp: streaming.startedAt,
                    steps: streaming.steps,
                    thinking: streaming.reasoning,
                    media: streaming.media,
                  }}
                />
              ) : null}
            </div>
          )}
        </div>

        {showScrollBtn && !workspacePanelOpen ? (
          <Button
            shape="circle"
            size="large"
            className="absolute right-5 bottom-[80px] z-10 shadow-lg"
            onClick={() => {
              setAutoScroll(true);
              scrollToBottom(true);
            }}
          >
            <AppIcon className="fas fa-chevron-down text-sm" />
          </Button>
        ) : null}

        <Composer />
      </div>

      {dragActive ? (
        <div className="drag-overlay active">
          <div className="drag-overlay-content">
            <AppIcon className="fas fa-cloud-arrow-up" />
            <p>{t('attach_menu_file')}</p>
          </div>
        </div>
      ) : null}

      <WorkspacePanel />
    </>
  );
}
