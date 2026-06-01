// 2026-06-01 の実データ。3 バリアントが同じデータを違う形で描画する。
window.NEWS_DATA = {
  date: '2026-06-01',
  fresh: 0,
  recurring: 11,
  model: 'claude-sonnet-4-6',
  highlights: [
    'Anthropic が Series H で 650 億ドルを調達、評価額 9,650 億ドル・年換算収益 470 億ドル突破を同時に公表',
    'Claude Code に Dynamic Workflows 機能が research preview として公開、1 セッションで数十から数百の並列サブエージェントを動作可能',
    'Anthropic Labs の新製品 Claude Design が research preview 公開、Claude Opus 4.7 搭載のビジュアル作成・プロトタイピングツール',
  ],
  categories: [
    {
      key: 'product',
      name: 'プロダクト・モデルリリース',
      icon: '📦',
      color: '#6366f1',
      bg: '#eef2ff',
      items: [
        {
          title: 'Dynamic Workflows in Claude Code',
          translation: 'Claude Code のダイナミックワークフロー',
          url: 'https://claude.com/blog/introducing-dynamic-workflows-in-claude-code',
          source: 'hacker-news',
          points: 192,
          date: '2026-05-28',
          state: '継続話題',
          recurrence: 7,
          summary:
            'Claude Code に Dynamic Workflows 機能が導入された。Claude が 1 セッションで数十から数百の並列サブエージェントを動作させるオーケストレーションスクリプトを自動生成し、結果をユーザーに届ける前に自ら検証を行う。',
          body: [
            '対象は単一エージェント 1 パスでは対処できない大規模・複雑な問題で、大規模レガシーコードベース全体のバグ探索、数百ファイルにまたがるマイグレーション、実行前に多角的にストレステストを行いたい計画などが想定ユースケースとして挙げられている。',
            '現在 research preview として Claude Code CLI・デスクトップアプリ・VS Code 拡張機能 (Max・Team・Enterprise プランで管理者が有効化した場合) で利用可能。Claude API、Amazon Bedrock、Vertex AI、Microsoft Foundry でも提供される。通常の Claude Code セッションより大幅にトークンを消費するため、まず範囲を絞ったタスクから試すことが推奨されている。',
            '使用方法は 2 種類。Claude に直接ワークフロー作成を依頼するか、effort メニューから新設の「ultracode」設定をオンにする方法がある。ultracode は effort レベルを xhigh に設定し、ワークフローを使用するかを Claude 自身に委ねる。',
          ],
        },
        {
          title: 'Claude Design Anthropic Labs',
          translation: 'Anthropic Labs による Claude Design の発表',
          url: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
          source: 'anthropic-blog',
          date: '2026-05-28',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Anthropic Labs の新製品 Claude Design が発表された。Claude と共同でデザイン・プロトタイプ・スライド・ワンページャーなどのビジュアル成果物を作成できるツールで、Claude Opus 4.7 を搭載する。',
          body: [
            'Claude Pro・Max・Team・Enterprise 加入者向けに research preview として提供され、当日中に段階的にロールアウトされた。ユーザーは求める成果物を説明すると Claude が最初のバージョンを生成し、以降は会話・インラインコメント・直接編集・カスタムスライダーを通じて調整できる。',
            '想定ユースケースとして、コードレビューや PR なしで共有可能なインタラクティブプロトタイプ、Claude Code への実装ハンドオフを想定したプロダクトワイヤーフレーム・モックアップ、PPTX エクスポートや Canva 送信に対応したピッチデッキ、音声・動画・シェーダー・3D を使用したコード駆動プロトタイプ作成が挙げられている。',
            'オンボーディング時にコードベースとデザインファイルを読み込みチーム用デザインシステムを構築する。テキストプロンプト・画像・ドキュメント (DOCX、PPTX、XLSX)・コードベース・Web キャプチャツールからのインポートに対応。',
          ],
        },
        {
          title: 'Claude Opus 4 8',
          translation: 'Claude Opus 4.8',
          url: 'https://www.anthropic.com/news/claude-opus-4-8',
          source: 'anthropic-blog',
          date: '2026-05-28',
          state: '継続話題',
          recurrence: 10,
          summary:
            '(本文取得失敗) Claude Opus 4.8 の発表記事。タイトルから Opus クラスのモデルリリースであることが読み取れる。',
          body: [],
        },
      ],
    },
    {
      key: 'devtool',
      name: '開発者ツール・SDK・インフラ',
      icon: '🛠',
      color: '#0891b2',
      bg: '#ecfeff',
      items: [
        {
          title: 'Claude Code Auto Mode',
          translation: 'Claude Code オートモードの構築：権限を安全にスキップする方法',
          url: 'https://www.anthropic.com/engineering/claude-code-auto-mode',
          source: 'anthropic-blog',
          date: '2026-05-27',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Claude Code のオートモードの仕組みについて Anthropic エンジニアリングチームが解説した記事。',
          body: [
            '従来は実行前にユーザーの承認を求めるが、テレメトリによれば約 93% が承認されており、件数増加に伴う「承認疲れ」が確認されていた。既存の回避策はビルトインサンドボックスと `--dangerously-skip-permissions` フラグだったが、それぞれ運用コストと安全性の問題があった。',
            'オートモードはモデルベースのクラシファイアに承認を委任する中間方式で、危険なアクションを検出しつつ、それ以外は承認プロンプトなしで実行する。社内インシデント例として、リモート Git ブランチの削除、GitHub 認証トークンの内部クラスターへのアップロード、本番 DB へのマイグレーションが Claude Opus 4.6 システムカードに記録されている。',
            '2 層の防御構造を持つ。入力層ではサーバーサイドのプロンプトインジェクション探知プローブがツール出力をスキャンし、出力層では Sonnet 4.6 上のトランスクリプトクラシファイアが各アクション実行前に判定する。クラシファイアは高速な単一トークンフィルター→連鎖的思考の 2 段階で動作する。',
          ],
        },
      ],
    },
    {
      key: 'business',
      name: '資金調達・買収・事業展開',
      icon: '💰',
      color: '#16a34a',
      bg: '#f0fdf4',
      items: [
        {
          title: 'Series H',
          translation: 'シリーズ H',
          url: 'https://www.anthropic.com/news/series-h',
          source: 'anthropic-blog',
          date: '2026-05-28',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Anthropic が Altimeter Capital・Dragoneer・Greenoaks・Sequoia Capital をリードとする Series H で 650 億ドルの資金調達を完了した。評価額は post-money で 9,650 億ドル。',
          body: [
            'Series G (2026 年 2 月) 以降も企業顧客での採用が拡大し、同月初旬に年換算収益が 470 億ドルを超えた。今回の資金は安全性・解釈可能性研究の推進、Claude への需要増加に対応するコンピュート拡張、製品・パートナーシップの拡大に充当される予定。',
            '共同リードに Capital Group・Coatue・D1 Capital Partners・GIC・ICONIQ・XN。Amazon からの 50 億ドルを含む 150 億ドルの既コミット分も含まれる。戦略的インフラパートナーとして Micron・Samsung・SK hynix が加わり、メモリ・ストレージ・ロジックチップ供給を通じてコンピュートスケールを支援する。',
            'コンピュート設備拡充として、Amazon との最大 5 ギガワットの新容量、Google・Broadcom との次世代 TPU 5 ギガワット分、SpaceX との Colossus 1・2 の GPU アクセス契約が締結された。Claude は AWS・Google Cloud・Azure の 3 大クラウドすべてで利用可能な初のフロンティアモデル。',
          ],
        },
        {
          title: 'Milan Office Opening',
          translation: 'ミラノオフィス開設',
          url: 'https://www.anthropic.com/news/milan-office-opening',
          source: 'anthropic-blog',
          date: '2026-05-28',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Anthropic がミラノに新オフィスを開設すると発表した。ロンドン・ダブリン・パリ・チューリッヒ・ミュンヘンに次ぐヨーロッパ 6 拠点目。',
          body: [
            'チームはイタリア企業および開発者コミュニティと協力し、Claude を活用した責任ある取り組みを推進する。教皇レオ 14 世が AI を主題として発表した初の回勅 Magnifica humanitas の公開直後に実施された。',
            'イタリア企業との既存連携として、金融分野で Generali Group・Unipol Group、生命科学で Angelini Pharma・Bracco Group、エネルギーで Enel Group、自動車で Pirelli。JAKALA とのパートナーシップでは Claude が 3,000 以上のシートに展開された。',
            'スタートアップでは Satispay がエンジニアリングチーム全体に Claude を導入し、18 ヵ月のロードマップを 7 ヵ月に圧縮、コア決済システムの更新速度を 10 倍に向上した。Bending Spoons ではコード変更の大多数が Claude Code との共同作業で行われている。',
          ],
        },
        {
          title: 'Kiyoung Choi Representative Director Anthropic Korea',
          translation: 'チェ・ギヨン氏、Anthropic Korea 代表取締役に就任',
          url: 'https://www.anthropic.com/news/kiyoung-choi-representative-director-anthropic-korea',
          source: 'anthropic-blog',
          date: '2026-05-26',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Anthropic がソウルオフィス開設に先立ち、KiYoung Choi (チェ・ギヨン) 氏を韓国代表取締役として採用したと発表した。',
          body: [
            'Anthropic の Economic Index によると、韓国における Claude.ai の利用頻度は人口規模から予測される水準の 3.5 倍を超えており、技術・クリエイティブ系の利用が多い。今後数週間のうちに Anthropic 上級幹部がソウルを訪問し、正式にオフィスを開設してカスタマーと面談する予定。',
            'チェ氏は Snowflake の韓国ゼネラルマネージャーを経て参画。韓国・アジア太平洋地域でのテクノロジービジネス経営に 30 年超の実績を持ち、Google Cloud・Adobe・Autodesk・Microsoft で国別リーダーシップを担った。',
            '現地パートナーとして、AI 法律アシスタントを展開する Law&Company と、カスタム AI カスタマーサービスモデルを構築した SK テレコムが挙げられている。',
          ],
        },
      ],
    },
    {
      key: 'research',
      name: '研究発表・論文',
      icon: '🔬',
      color: '#c026d3',
      bg: '#fdf4ff',
      items: [
        {
          title: 'Coding Agents Social Sciences',
          translation: '社会科学分野のコーディングエージェント',
          url: 'https://www.anthropic.com/research/coding-agents-social-sciences',
          source: 'anthropic-blog',
          date: '2026-05-27',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Anthropic が 2026 年 2 月〜3 月に実施した定量的社会科学者 1,260 名を対象とするアンケート調査の結果を報告した。',
          body: [
            '回答者の 81% が AI チャットボットを研究に使用した経験を持ち、一方でコーディングエージェントを業務に採用しているのは 20% にとどまる。コーディングエージェント利用には格差があり、男性名とされる研究者は女性名とされる研究者の 2 倍の利用率を示した。',
            '上位大学の研究者は他の研究者と比べてコーディングエージェントを使用する確率が 40% 高い。コーディングエージェントのユーザーは同じ分野・キャリアステージの他の研究者と比較してワーキングペーパーや研究助成申請書をより多く公開・提出しているが、この差異は初期採用者の既存の差異を反映している可能性が指摘されている。',
            'この調査はコーディングエージェントが研究生産性に与える影響を調べる大規模継続研究のベースライン調査として実施された。Claude Max アカウントへのアクセス提供を伴う参加者募集のため、標本が AI ツールへの関心層に偏っている可能性が注記されている。',
          ],
        },
      ],
    },
    {
      key: 'safety',
      name: '安全性・倫理・規制・社会影響',
      icon: '🛡',
      color: '#ea580c',
      bg: '#fff7ed',
      items: [
        {
          title: 'How We Contain Claude',
          translation: 'Claude の封じ込め方法',
          url: 'https://www.anthropic.com/engineering/how-we-contain-claude',
          source: 'anthropic-blog',
          date: '2026-05-28',
          state: '継続話題',
          recurrence: 10,
          summary:
            'Anthropic エンジニアリングチームが、claude.ai・Claude Code・Claude Cowork の 3 製品にわたるエージェント封じ込めアーキテクチャについて解説した記事。',
          body: [
            '12 ヵ月前は内部サービスを停止させるほどのアクセスを Claude に付与することは否定されていたが、現在ではそのレベルのアクセスが通常運用となり開発者の生産性向上に寄与している。デプロイリスクは「障害発生確率」と「被害の大きさ (ブラストラディウス)」の 2 要素で構成される。',
            'ブラストラディウスを抑制するアプローチは 2 種類。第一はヒューマン・イン・ザ・ループによる監督で、ユーザーが権限プロンプトの約 93% を承認することが確認されており、承認疲れ問題が生じる。Claude Code オートモードはこの問題を軽減するために構築された。',
            '第二の封じ込めアプローチは、サンドボックス・仮想マシン・出口制御などによるアクセス境界の強制であり、本記事の中心トピック。セキュリティリスクはユーザーによる誤用とモデルの誤動作の 3 カテゴリに分類されている。',
          ],
        },
        {
          title: 'Chris Olah Pope Leo Encyclical',
          translation: 'Chris Olah による教皇レオ 14 世の回勅「Magnifica humanitas」への発言',
          url: 'https://www.anthropic.com/news/chris-olah-pope-leo-encyclical',
          source: 'anthropic-blog',
          date: '2026-05-25',
          state: '継続話題',
          recurrence: 10,
          summary:
            '2026 年 5 月 25 日、教皇レオ 14 世が AI を主題とした回勅 Magnifica humanitas を発表。Anthropic 共同創業者の Chris Olah がバチカン市国での回勅発表式典でのスピーチに招待された。',
          body: [
            'スピーチではすべてのフロンティア AI ラボが正しいことを行うことと相反し得るインセンティブや制約の中で運営されていると述べ、商業的存続や研究フロンティアにとどまる圧力、地政学的圧力、誇りや野心といった圧力の存在を認めた。',
            'それゆえにそれらのインセンティブの外側に立ち、注意深く見守り、困難なことを発言し、誠実で思慮深い批評者となる意志を持つ人々の存在が極めて重要であるとし、Magnifica humanitas にそのような役割を見出していると述べた。',
            'AI モデルの性質について、橋や航空機のように設計されたものではなく、脳を大まかにモデル化した構造上で人間の思考と言語という膨大な遺産を用いて「育てられた」ものであり、訓練した者にさえ重要な点で謎のままであると述べた。',
          ],
        },
      ],
    },
    {
      key: 'voice',
      name: '開発者・利用者の声',
      icon: '🗣',
      color: '#0284c7',
      bg: '#f0f9ff',
      items: [
        {
          title: 'With Claude: Less Coding, More Testing',
          translation: 'Claude を使って：コーディングが減り、テストが増えた',
          url: 'https://henrikwarne.com/2026/05/31/with-claude-less-coding-more-testing/',
          source: 'hacker-news',
          points: 22,
          date: '2026-05-31',
          state: '継続話題',
          recurrence: 10,
          summary:
            'ソフトウェアエンジニアの Henrik Warne 氏による、数ヵ月間の Claude Code 使用体験を綴った個人ブログ記事。',
          body: [
            'Claude Code を使い始めてから、コードを書く量は大幅に減り、Claude が書いたコードを理解・テストすることに多くの時間を費やすようになった。それでも全体としてはソフトウェア開発の感覚を保っており、開発の喜びを損なうことなく多くのフェーズが高速化したとしている。',
            'Claude が書いたコードでも必ず自分で確認し、時には編集する姿勢を維持。アーキテクチャから実装詳細まで多層的に理解することが重要であるという考えの理由として、変更に自分の名前が付く以上それを保証できる状態でありたいことと、短い仕様書では捉えきれない実装の詳細がシステムの挙動に影響を与えることを挙げている。',
            'コーディングのプロセスでは、新機能の開発時にチケットの説明が明確かを Claude に確認した上で解決策の提案を求める。テストについては、深夜にしか実行されない処理を 1 分後に動かす一時的な変更を Claude に依頼するなど、柔軟な検証が可能になったとしている。',
          ],
        },
      ],
    },
  ],
}
