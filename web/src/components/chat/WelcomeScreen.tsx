import { AppIcon } from '@/components/ui/AppIcon';
import { Card } from 'antd';
import { useI18n } from '@/i18n/useI18n';
import { useChat } from '@/store/chat';
import { BrandMark } from '@/components/ui/BrandMark';

interface Example {
  titleKey: string;
  textKey: string;
  icon: string;
  chip: string;
  glyph: string;
  send: string;
}

const EXAMPLES: Example[] = [
  { titleKey: 'example_sys_title', textKey: 'example_sys_text', icon: 'fa-folder-open', chip: 'bg-blue-50 dark:bg-blue-900/30', glyph: 'text-blue-500', send: '查看工作空间里有哪些文件' },
  { titleKey: 'example_task_title', textKey: 'example_task_text', icon: 'fa-clock', chip: 'bg-amber-50 dark:bg-amber-900/30', glyph: 'text-amber-500', send: '1分钟后提醒我检查服务器' },
  { titleKey: 'example_code_title', textKey: 'example_code_text', icon: 'fa-code', chip: 'bg-emerald-50 dark:bg-emerald-900/30', glyph: 'text-emerald-500', send: '搜索AI资讯并生成可视化网页报告' },
  { titleKey: 'example_knowledge_title', textKey: 'example_knowledge_text', icon: 'fa-book', chip: 'bg-violet-50 dark:bg-violet-900/30', glyph: 'text-violet-500', send: '查看知识库当前文档情况' },
  { titleKey: 'example_skill_title', textKey: 'example_skill_text', icon: 'fa-puzzle-piece', chip: 'bg-rose-50 dark:bg-rose-900/30', glyph: 'text-rose-500', send: '查看所有支持的工具和技能' },
  { titleKey: 'example_web_title', textKey: 'example_web_text', icon: 'fa-terminal', chip: 'bg-slate-100 dark:bg-slate-800', glyph: 'text-slate-500', send: '/help' },
];

export function WelcomeScreen() {
  const { t } = useI18n();
  const { sendMessage } = useChat();

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 pb-16" style={{ paddingTop: '6vh' }}>
      <BrandMark className="w-16 h-16 mb-6 shadow-lg shadow-primary-500/20" rounded="rounded-2xl" glyph="text-2xl" />
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-3">Gopher Agent</h1>
      <p
        className="text-slate-500 dark:text-slate-400 text-center max-w-lg mb-10 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: t('welcome_subtitle') }}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-2xl">
        {EXAMPLES.map((ex) => (
          <Card
            key={ex.titleKey}
            hoverable
            size="small"
            onClick={() => void sendMessage(ex.send)}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${ex.chip}`}>
                <AppIcon className={`fas ${ex.icon} ${ex.glyph} text-xs`} />
              </div>
              <span className="font-medium text-sm text-slate-700 dark:text-slate-200">{t(ex.titleKey)}</span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{t(ex.textKey)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
