export type RuleKind = '原文阈值' | '原文方向' | '流程护栏';

export type LynchRule = {
  id: string;
  title: string;
  chapter: string;
  section: string;
  kind: RuleKind;
  test: string;
  weight: number | null;
  note: string;
};

export const bookEdition = {
  title: '《彼得·林奇的成功投资（典藏版）》',
  publisher: '机械工业出版社',
  year: '2018',
  isbn: '978-7-111-59073-6',
};

export const lynchRules: LynchRule[] = [
  {
    id: 'LYN-07-CLASSIFY',
    title: '先判断公司类型，再选择分析方式',
    chapter: '第7章',
    section: '6种类型公司股票',
    kind: '流程护栏',
    test: '缓慢增长 / 稳定增长 / 快速增长 / 周期 / 困境反转 / 隐蔽资产',
    weight: null,
    note: '不同类型不能套用同一套阈值；分类缺失时不出总分。',
  },
  {
    id: 'LYN-13-PEGD',
    title: '收益增长、股息与市盈率的匹配',
    chapter: '第13章',
    section: '市盈率',
    kind: '原文阈值',
    test: '(长期收益增长率 + 股息收益率) ÷ 市盈率：<1 较差；约1.5 尚可；≥2 理想',
    weight: 20,
    note: '阈值来自书中；20分权重是MVP产品政策，可由用户修改。',
  },
  {
    id: 'LYN-13-CASH',
    title: '检查净现金对股价的支撑',
    chapter: '第13章',
    section: '现金头寸',
    kind: '原文方向',
    test: '(现金及等价物－有息负债) ÷ 总股本，并与当前股价比较',
    weight: 10,
    note: '书中要求看每股净现金的实际影响，不把“有现金”直接等同于便宜。',
  },
  {
    id: 'LYN-13-DEBT',
    title: '负债与股东权益结构',
    chapter: '第13章',
    section: '负债因素',
    kind: '原文阈值',
    test: '书中举例：正常资产负债结构中，股东权益约75%，负债低于25%',
    weight: 15,
    note: '金融企业不直接适用；系统会按行业标记例外。',
  },
  {
    id: 'LYN-13-INVENTORY',
    title: '存货增速与销售增速交叉核查',
    chapter: '第13章',
    section: '存货',
    kind: '原文方向',
    test: '制造与零售企业中，存货异常快于销售增长应触发警报',
    weight: 10,
    note: '这是趋势核查，不人为设一个适用于所有行业的固定百分比。',
  },
  {
    id: 'LYN-13-FCF',
    title: '自由现金流是否真实、持续',
    chapter: '第13章',
    section: '现金流',
    kind: '原文方向',
    test: '经营现金流扣除维持业务所需资本开支后仍为正，并查看多年趋势',
    weight: 10,
    note: '财报口径先由程序计算，AI只解释异常来源。',
  },
  {
    id: 'LYN-13-MARGIN',
    title: '利润率水平及变化',
    chapter: '第13章',
    section: '税前利润',
    kind: '原文方向',
    test: '长期持有偏好相对较高且稳定的利润率；周期复苏需另行判断',
    weight: 10,
    note: '必须结合公司类型，不能孤立地把低利润率判为坏公司。',
  },
  {
    id: 'LYN-15-FAST-GROWTH',
    title: '快速增长型的收益增长区间',
    chapter: '第15章',
    section: '快速增长型公司的股票',
    kind: '原文阈值',
    test: '书中偏好20%～25%；对看似能持续高于25%的增长保持警惕',
    weight: 20,
    note: '仅在公司被分类为快速增长型后启用。',
  },
  {
    id: 'LYN-14-RECHECK',
    title: '定期重新核查投资故事',
    chapter: '第14章',
    section: '定期重新核查公司分析',
    kind: '流程护栏',
    test: '新季度数据到达时，检查收益与原先判断是否一致、增长阶段是否改变',
    weight: null,
    note: 'MVP会保存每次分析快照，后续版本自动生成变化记录。',
  },
];

export const demoChecks = [
  {
    id: 'LYN-15-FAST-GROWTH',
    value: '22.0%',
    result: '通过',
    score: 20,
    max: 20,
    evidence: '演示数据：近5年归母净利润复合增速',
  },
  {
    id: 'LYN-13-PEGD',
    value: '1.29×',
    result: '一般',
    score: 10,
    max: 20,
    evidence: '(22.0% + 1.2%) ÷ 18.0',
  },
  {
    id: 'LYN-13-DEBT',
    value: '20.0%',
    result: '通过',
    score: 15,
    max: 15,
    evidence: '有息负债 ÷（有息负债 + 股东权益）',
  },
  {
    id: 'LYN-13-CASH',
    value: '5.30元/股',
    result: '通过',
    score: 10,
    max: 10,
    evidence: '净现金为正，占演示股价12.6%',
  },
  {
    id: 'LYN-13-INVENTORY',
    value: '8% < 15%',
    result: '通过',
    score: 10,
    max: 10,
    evidence: '存货同比增速低于营业收入同比增速',
  },
  {
    id: 'LYN-13-FCF',
    value: '连续3年为正',
    result: '通过',
    score: 10,
    max: 10,
    evidence: '经营现金流－维持性资本开支',
  },
  {
    id: 'LYN-13-MARGIN',
    value: '18.0% / 17.0%',
    result: '通过',
    score: 10,
    max: 10,
    evidence: '本期税前利润率 / 上期税前利润率',
  },
];
