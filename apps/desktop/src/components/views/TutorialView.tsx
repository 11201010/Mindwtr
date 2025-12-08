import { CheckCircle2, Inbox, Layers, ListTodo } from 'lucide-react';
import { useLanguage } from '../../contexts/language-context';


export function TutorialView() {
    const { t } = useLanguage();

    return (
        <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto">
            <header className="mb-10 text-center">
                <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
                    {t('tutorial.title')}
                </h1>
                <p className="text-xl text-muted-foreground">
                    {t('tutorial.subtitle')}
                </p>
            </header>

            <div className="space-y-12">
                <section>
                    <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600">
                            <Inbox className="w-6 h-6" />
                        </div>
                        {t('tutorial.capture')}
                    </h2>
                    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                        <p className="mb-4 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('tutorial.captureText') }} />
                        <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                            <li>{t('tutorial.captureList1')}</li>
                            <li>{t('tutorial.captureList2')}</li>
                            <li>{t('tutorial.captureList3')}</li>
                        </ul>
                    </div>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-600">
                            <ListTodo className="w-6 h-6" />
                        </div>
                        {t('tutorial.clarify')}
                    </h2>
                    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                        <p className="mb-4 leading-relaxed">
                            {t('tutorial.clarifyText')}
                        </p>
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <h3 className="font-medium">{t('tutorial.actionable')}</h3>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    <li>{t('tutorial.nextActions')}</li>
                                    <li>{t('tutorial.projects')}</li>
                                    <li>{t('tutorial.waitingFor')}</li>
                                    <li>{t('tutorial.calendar')}</li>
                                </ul>
                            </div>
                            <div className="space-y-2">
                                <h3 className="font-medium">{t('tutorial.notActionable')}</h3>
                                <ul className="space-y-2 text-sm text-muted-foreground">
                                    <li>{t('tutorial.someday')}</li>
                                    <li>{t('tutorial.reference')}</li>
                                    <li>{t('tutorial.trash')}</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-purple-600">
                            <CheckCircle2 className="w-6 h-6" />
                        </div>
                        {t('tutorial.reflect')}
                    </h2>
                    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                        <p className="mb-4 leading-relaxed" dangerouslySetInnerHTML={{ __html: t('tutorial.reflectText') }} />
                        <p className="text-muted-foreground mb-4">
                            {t('tutorial.reflectHint')}
                        </p>
                        <ol className="list-decimal list-inside space-y-2 text-muted-foreground ml-4">
                            <li>{t('tutorial.reflectStep1')}</li>
                            <li>{t('tutorial.reflectStep2')}</li>
                            <li>{t('tutorial.reflectStep3')}</li>
                            <li>{t('tutorial.reflectStep4')}</li>
                        </ol>
                    </div>
                </section>

                <section>
                    <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-orange-600">
                            <Layers className="w-6 h-6" />
                        </div>
                        {t('tutorial.features')}
                    </h2>
                    <div className="grid md:grid-cols-3 gap-6">
                        <div className="bg-card border border-border rounded-xl p-4">
                            <h3 className="font-medium mb-2">{t('tutorial.contextsTitle')}</h3>
                            <p className="text-sm text-muted-foreground">
                                {t('tutorial.contextsText')}
                            </p>
                        </div>
                        <div className="bg-card border border-border rounded-xl p-4">
                            <h3 className="font-medium mb-2">{t('tutorial.projectsTitle')}</h3>
                            <p className="text-sm text-muted-foreground">
                                {t('tutorial.projectsText')}
                            </p>
                        </div>
                        <div className="bg-card border border-border rounded-xl p-4">
                            <h3 className="font-medium mb-2">{t('tutorial.boardTitle')}</h3>
                            <p className="text-sm text-muted-foreground">
                                {t('tutorial.boardText')}
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

